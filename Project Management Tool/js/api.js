(() => {
  const LOCAL_DB_KEY = window.pmApp.storageKeys.localDb;
  const KNOWN_API_PREFIXES = [
    "/register",
    "/login",
    "/profile",
    "/projects",
    "/tasks",
    "/comments",
    "/notifications"
  ];
  const ATTACHMENT_LIMIT_BYTES = 1500 * 1024;

  const createError = (message, statusCode = 400) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
  };

  const createDefaultDb = () => ({
    users: [],
    projects: [],
    tasks: [],
    comments: [],
    notifications: []
  });

  const nowIso = () => new Date().toISOString();
  const normalizeEmail = (value = "") => String(value).trim().toLowerCase();
  const uniqueValues = (values) => [...new Set(values.filter(Boolean))];

  const parseListInput = (value) => {
    if (!value) {
      return [];
    }

    if (Array.isArray(value)) {
      return value.map((item) => String(item).trim()).filter(Boolean);
    }

    return String(value)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  };

  const readDb = () => {
    try {
      const raw = localStorage.getItem(LOCAL_DB_KEY);
      if (!raw) {
        return createDefaultDb();
      }

      const parsed = JSON.parse(raw);
      return {
        ...createDefaultDb(),
        ...parsed
      };
    } catch (error) {
      return createDefaultDb();
    }
  };

  const writeDb = (db) => {
    localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(db));
    return db;
  };

  const findUserById = (db, userId) => db.users.find((user) => user._id === String(userId));
  const findProjectById = (db, projectId) =>
    db.projects.find((project) => project._id === String(projectId));
  const findTaskById = (db, taskId) => db.tasks.find((task) => task._id === String(taskId));
  const findCommentById = (db, commentId) =>
    db.comments.find((comment) => comment._id === String(commentId));

  const toPublicUser = (user) =>
    user
      ? {
          _id: user._id,
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          isOnline: Boolean(user.isOnline),
          lastSeen: user.lastSeen
        }
      : null;

  const getCurrentUser = (db) => {
    const sessionUser = window.pmApp.getUser();
    const userId = sessionUser?._id || sessionUser?.id;
    const user = findUserById(db, userId);

    if (!user) {
      throw createError("Please log in to continue.", 401);
    }

    return user;
  };

  const createToken = () => window.pmApp.createId("token");

  const buildAuthResponse = (user) => ({
    token: createToken(),
    user: toPublicUser(user)
  });

  const createNameFromEmail = (email) => {
    const base = normalizeEmail(email).split("@")[0] || "guest-member";
    return base
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  };

  const createPlaceholderUser = (db, email) => {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      return null;
    }

    const existingUser = db.users.find((user) => user.email === normalizedEmail);
    if (existingUser) {
      return existingUser;
    }

    const timestamp = nowIso();
    const placeholderUser = {
      _id: window.pmApp.createId("user"),
      name: createNameFromEmail(normalizedEmail),
      email: normalizedEmail,
      passwordHash: null,
      role: "member",
      isOnline: false,
      lastSeen: timestamp,
      isPlaceholder: true,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    db.users.push(placeholderUser);
    return placeholderUser;
  };

  const populateProject = (db, project) => ({
    ...project,
    owner: toPublicUser(findUserById(db, project.owner)),
    members: (project.members || [])
      .map((memberId) => toPublicUser(findUserById(db, memberId)))
      .filter(Boolean)
  });

  const minimalProject = (db, projectId) => {
    const project = findProjectById(db, projectId);
    if (!project) {
      return null;
    }

    return {
      _id: project._id,
      title: project.title,
      deadline: project.deadline,
      members: (project.members || [])
        .map((memberId) => toPublicUser(findUserById(db, memberId)))
        .filter(Boolean)
    };
  };

  const populateTask = (db, task) => ({
    ...task,
    project: minimalProject(db, task.project) || task.project,
    assignedTo: toPublicUser(findUserById(db, task.assignedTo)),
    createdBy: toPublicUser(findUserById(db, task.createdBy)),
    activity: (task.activity || []).map((activity) => ({
      ...activity,
      user: toPublicUser(findUserById(db, activity.user)) || activity.user
    }))
  });

  const populateComment = (db, comment) => {
    const parentComment = comment.parentComment ? findCommentById(db, comment.parentComment) : null;

    return {
      ...comment,
      user: toPublicUser(findUserById(db, comment.user)),
      parentComment: parentComment
        ? {
            _id: parentComment._id,
            message: parentComment.message,
            user: toPublicUser(findUserById(db, parentComment.user))
          }
        : null
    };
  };

  const ensureProjectMembership = (db, projectId, userId) => {
    const project = findProjectById(db, projectId);

    if (!project) {
      throw createError("Project not found.", 404);
    }

    if (!(project.members || []).includes(String(userId))) {
      throw createError("You do not have access to this project.", 403);
    }

    return project;
  };

  const ensureTaskMembership = (db, taskId, userId) => {
    const task = findTaskById(db, taskId);

    if (!task) {
      throw createError("Task not found.", 404);
    }

    const project = ensureProjectMembership(db, task.project, userId);
    return { task, project };
  };

  const parseMentionedUsers = (db, task, message) => {
    const handles = [...String(message).matchAll(/@([a-zA-Z0-9._-]+)/g)].map((match) =>
      match[1].toLowerCase()
    );

    if (!handles.length) {
      return [];
    }

    const project = findProjectById(db, task.project);
    const members = (project?.members || []).map((memberId) => findUserById(db, memberId)).filter(Boolean);

    return members
      .filter((member) => {
        const emailPrefix = member.email.split("@")[0].toLowerCase();
        const compactName = member.name.toLowerCase().replace(/\s+/g, "");
        return handles.includes(emailPrefix) || handles.includes(compactName);
      })
      .map((member) => member._id);
  };

  const createNotifications = (db, userIds, payload) => {
    const timestamp = nowIso();

    uniqueValues(userIds).forEach((userId) => {
      db.notifications.unshift({
        _id: window.pmApp.createId("notification"),
        user: userId,
        type: payload.type || "info",
        message: payload.message,
        entityType: payload.entityType || "system",
        entityId: payload.entityId || null,
        isRead: false,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    });
  };

  const hashPassword = async (password) => {
    if (globalThis.crypto?.subtle) {
      const bytes = new TextEncoder().encode(password);
      const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest))
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
    }

    return btoa(password);
  };

  const readFileAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(createError(`Could not read "${file.name}".`, 400));
      reader.readAsDataURL(file);
    });

  const formDataToObject = async (formData) => {
    const normalized = {};
    const attachments = [];

    for (const [key, value] of formData.entries()) {
      if (value instanceof File) {
        if (!value.name || value.size === 0) {
          continue;
        }

        if (key === "attachments") {
          if (value.size > ATTACHMENT_LIMIT_BYTES) {
            throw createError(
              "Attachments above 1.5MB are not supported in direct HTML mode.",
              400
            );
          }

          attachments.push({
            fileName: value.name,
            fileUrl: await readFileAsDataUrl(value),
            fileSize: value.size
          });
        }

        continue;
      }

      normalized[key] = value;
    }

    if (attachments.length) {
      normalized.attachments = attachments;
    }

    return normalized;
  };

  const normalizeBody = async (body, isFormData) => {
    if (body === undefined || body === null) {
      return {};
    }

    if (!isFormData) {
      return body;
    }

    return formDataToObject(body);
  };

  const isKnownApiPath = (path) => {
    const url = new URL(path, "https://flowforge.local");
    return KNOWN_API_PREFIXES.some(
      (prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)
    );
  };

  const sortByNewest = (entries, field = "updatedAt") =>
    [...entries].sort((a, b) => new Date(b[field] || b.createdAt) - new Date(a[field] || a.createdAt));

  const handleLocalRequest = async (path, options = {}) => {
    const { method = "GET", body, isFormData = false } = options;
    const normalizedMethod = method.toUpperCase();
    const url = new URL(path, "https://flowforge.local");
    const pathName = url.pathname;
    const bodyData = await normalizeBody(body, isFormData);
    const db = readDb();

    if (normalizedMethod === "POST" && pathName === "/register") {
      const name = String(bodyData.name || "").trim();
      const email = normalizeEmail(bodyData.email);
      const password = String(bodyData.password || "");
      const role = String(bodyData.role || "member");

      if (!name || !email || !password) {
        throw createError("Name, email, and password are required.", 400);
      }

      let user = db.users.find((entry) => entry.email === email);
      if (user && user.passwordHash) {
        throw createError("A user with this email already exists.", 409);
      }

      const timestamp = nowIso();
      const passwordHash = await hashPassword(password);

      if (user) {
        user.name = name;
        user.passwordHash = passwordHash;
        user.role = role;
        user.isPlaceholder = false;
        user.isOnline = true;
        user.lastSeen = timestamp;
        user.updatedAt = timestamp;
      } else {
        user = {
          _id: window.pmApp.createId("user"),
          name,
          email,
          passwordHash,
          role,
          isOnline: true,
          lastSeen: timestamp,
          isPlaceholder: false,
          createdAt: timestamp,
          updatedAt: timestamp
        };
        db.users.push(user);
      }

      writeDb(db);
      return buildAuthResponse(user);
    }

    if (normalizedMethod === "POST" && pathName === "/login") {
      const email = normalizeEmail(bodyData.email);
      const password = String(bodyData.password || "");
      const user = db.users.find((entry) => entry.email === email);

      if (!user || !user.passwordHash) {
        throw createError("Invalid email or password.", 401);
      }

      const passwordHash = await hashPassword(password);
      if (user.passwordHash !== passwordHash) {
        throw createError("Invalid email or password.", 401);
      }

      user.isOnline = true;
      user.lastSeen = nowIso();
      user.updatedAt = user.lastSeen;
      writeDb(db);

      return buildAuthResponse(user);
    }

    if (normalizedMethod === "GET" && pathName === "/profile") {
      const currentUser = getCurrentUser(db);
      currentUser.isOnline = true;
      currentUser.lastSeen = nowIso();
      currentUser.updatedAt = currentUser.lastSeen;
      writeDb(db);
      return {
        user: toPublicUser(currentUser)
      };
    }

    if (normalizedMethod === "GET" && pathName === "/projects") {
      const currentUser = getCurrentUser(db);
      return sortByNewest(
        db.projects
          .filter((project) => (project.members || []).includes(currentUser._id))
          .map((project) => populateProject(db, project))
      );
    }

    if (normalizedMethod === "POST" && pathName === "/projects") {
      const currentUser = getCurrentUser(db);
      const title = String(bodyData.title || "").trim();

      if (!title) {
        throw createError("Project title is required.", 400);
      }

      const invitedUsers = parseListInput(bodyData.memberEmails)
        .map((email) => createPlaceholderUser(db, email))
        .filter(Boolean);

      const timestamp = nowIso();
      const project = {
        _id: window.pmApp.createId("project"),
        title,
        description: String(bodyData.description || "").trim(),
        owner: currentUser._id,
        members: uniqueValues([currentUser._id, ...invitedUsers.map((user) => user._id)]),
        deadline: bodyData.deadline || null,
        status: "active",
        createdAt: timestamp,
        updatedAt: timestamp
      };

      db.projects.unshift(project);
      createNotifications(
        db,
        invitedUsers.map((user) => user._id).filter((userId) => userId !== currentUser._id),
        {
          message: `${currentUser.name} added you to the project "${project.title}".`,
          entityType: "project",
          entityId: project._id
        }
      );
      writeDb(db);

      return populateProject(db, project);
    }

    if (pathName.startsWith("/projects/")) {
      const projectId = pathName.split("/")[2];
      const currentUser = getCurrentUser(db);
      const project = findProjectById(db, projectId);

      if (!project) {
        throw createError("Project not found.", 404);
      }

      if (normalizedMethod === "PUT") {
        ensureProjectMembership(db, projectId, currentUser._id);

        const previousMembers = [...(project.members || [])];
        if (bodyData.title !== undefined) project.title = String(bodyData.title || "").trim();
        if (bodyData.description !== undefined) {
          project.description = String(bodyData.description || "").trim();
        }
        if (bodyData.deadline !== undefined) project.deadline = bodyData.deadline || null;
        if (bodyData.status !== undefined) project.status = bodyData.status || "active";

        if (bodyData.memberEmails !== undefined) {
          const nextUsers = parseListInput(bodyData.memberEmails)
            .map((email) => createPlaceholderUser(db, email))
            .filter(Boolean);

          project.members = uniqueValues([
            project.owner,
            currentUser._id,
            ...nextUsers.map((user) => user._id)
          ]);

          const newMemberIds = project.members.filter(
            (memberId) => !previousMembers.includes(memberId) && memberId !== currentUser._id
          );

          createNotifications(db, newMemberIds, {
            message: `${currentUser.name} added you to the project "${project.title}".`,
            entityType: "project",
            entityId: project._id
          });
        }

        project.updatedAt = nowIso();
        writeDb(db);
        return populateProject(db, project);
      }

      if (normalizedMethod === "DELETE") {
        if (String(project.owner) !== String(currentUser._id)) {
          throw createError("Only the project owner can delete this project.", 403);
        }

        const taskIds = db.tasks
          .filter((task) => task.project === projectId)
          .map((task) => task._id);
        const commentIds = db.comments
          .filter((comment) => taskIds.includes(comment.task))
          .map((comment) => comment._id);

        db.projects = db.projects.filter((entry) => entry._id !== projectId);
        db.tasks = db.tasks.filter((task) => task.project !== projectId);
        db.comments = db.comments.filter((comment) => !taskIds.includes(comment.task));
        db.notifications = db.notifications.filter(
          (notification) =>
            notification.entityId !== projectId &&
            !taskIds.includes(notification.entityId) &&
            !commentIds.includes(notification.entityId)
        );

        writeDb(db);
        return { message: "Project deleted successfully." };
      }
    }

    if (normalizedMethod === "GET" && pathName === "/tasks") {
      const currentUser = getCurrentUser(db);
      const projectId = url.searchParams.get("projectId");
      let tasks = db.tasks;

      if (projectId) {
        ensureProjectMembership(db, projectId, currentUser._id);
        tasks = tasks.filter((task) => task.project === projectId);
      } else {
        const memberProjectIds = db.projects
          .filter((project) => (project.members || []).includes(currentUser._id))
          .map((project) => project._id);
        tasks = tasks.filter((task) => memberProjectIds.includes(task.project));
      }

      return sortByNewest(tasks, "createdAt").map((task) => populateTask(db, task));
    }

    if (normalizedMethod === "POST" && pathName === "/tasks") {
      const currentUser = getCurrentUser(db);
      const projectId = String(bodyData.project || "");
      const title = String(bodyData.title || "").trim();

      if (!projectId || !title) {
        throw createError("Project and title are required.", 400);
      }

      const project = ensureProjectMembership(db, projectId, currentUser._id);
      const assignedTo = bodyData.assignedTo ? String(bodyData.assignedTo) : null;

      if (assignedTo && !(project.members || []).includes(assignedTo)) {
        throw createError("Assigned user must be a member of the project.", 400);
      }

      const timestamp = nowIso();
      const task = {
        _id: window.pmApp.createId("task"),
        project: projectId,
        title,
        description: String(bodyData.description || "").trim(),
        assignedTo,
        createdBy: currentUser._id,
        status: bodyData.status || "To Do",
        priority: bodyData.priority || "Medium",
        dueDate: bodyData.dueDate || null,
        labels: parseListInput(bodyData.labels),
        attachments: Array.isArray(bodyData.attachments) ? bodyData.attachments : [],
        activity: [
          {
            type: "created",
            message: `${currentUser.name} created this task.`,
            user: currentUser._id,
            createdAt: timestamp
          }
        ],
        createdAt: timestamp,
        updatedAt: timestamp
      };

      db.tasks.unshift(task);
      project.updatedAt = timestamp;

      if (assignedTo && assignedTo !== currentUser._id) {
        createNotifications(db, [assignedTo], {
          message: `${currentUser.name} assigned you the task "${task.title}".`,
          entityType: "task",
          entityId: task._id
        });
      }

      writeDb(db);
      return populateTask(db, task);
    }

    if (pathName.startsWith("/tasks/")) {
      const taskId = pathName.split("/")[2];
      const currentUser = getCurrentUser(db);

      if (normalizedMethod === "PUT") {
        const { task, project } = ensureTaskMembership(db, taskId, currentUser._id);
        const previousAssignedTo = task.assignedTo || null;
        const previousStatus = task.status;
        const nextAssignedTo =
          bodyData.assignedTo !== undefined
            ? bodyData.assignedTo
              ? String(bodyData.assignedTo)
              : null
            : task.assignedTo;

        if (nextAssignedTo && !(project.members || []).includes(nextAssignedTo)) {
          throw createError("Assigned user must be a member of the project.", 400);
        }

        let changed = false;

        if (bodyData.title !== undefined) {
          task.title = String(bodyData.title || "").trim();
          changed = true;
        }
        if (bodyData.description !== undefined) {
          task.description = String(bodyData.description || "").trim();
          changed = true;
        }
        if (bodyData.status !== undefined) {
          task.status = bodyData.status || task.status;
          changed = true;
        }
        if (bodyData.priority !== undefined) {
          task.priority = bodyData.priority || task.priority;
          changed = true;
        }
        if (bodyData.dueDate !== undefined) {
          task.dueDate = bodyData.dueDate || null;
          changed = true;
        }
        if (bodyData.labels !== undefined) {
          task.labels = parseListInput(bodyData.labels);
          changed = true;
        }
        if (bodyData.assignedTo !== undefined) {
          task.assignedTo = nextAssignedTo;
          changed = true;
        }
        if (Array.isArray(bodyData.attachments) && bodyData.attachments.length) {
          task.attachments = [...(task.attachments || []), ...bodyData.attachments];
          changed = true;
        }

        const timestamp = nowIso();
        task.activity = task.activity || [];

        if (previousStatus !== task.status) {
          task.activity.push({
            type: "status",
            message: `${currentUser.name} moved this task to ${task.status}.`,
            user: currentUser._id,
            createdAt: timestamp
          });
        }

        if (previousAssignedTo !== task.assignedTo) {
          task.activity.push({
            type: "assignment",
            message: `${currentUser.name} updated the assignee.`,
            user: currentUser._id,
            createdAt: timestamp
          });
        }

        if (changed) {
          task.activity.push({
            type: "update",
            message: `${currentUser.name} updated this task.`,
            user: currentUser._id,
            createdAt: timestamp
          });
        }

        task.updatedAt = timestamp;
        project.updatedAt = timestamp;

        if (
          task.assignedTo &&
          task.assignedTo !== currentUser._id &&
          task.assignedTo !== previousAssignedTo
        ) {
          createNotifications(db, [task.assignedTo], {
            message: `${currentUser.name} assigned you the task "${task.title}".`,
            entityType: "task",
            entityId: task._id
          });
        }

        writeDb(db);
        return populateTask(db, task);
      }

      if (normalizedMethod === "DELETE") {
        const { task } = ensureTaskMembership(db, taskId, currentUser._id);
        const commentIds = db.comments
          .filter((comment) => comment.task === taskId)
          .map((comment) => comment._id);

        db.tasks = db.tasks.filter((entry) => entry._id !== taskId);
        db.comments = db.comments.filter((comment) => comment.task !== taskId);
        db.notifications = db.notifications.filter(
          (notification) =>
            notification.entityId !== taskId && !commentIds.includes(notification.entityId)
        );

        writeDb(db);
        return { message: "Task deleted successfully." };
      }
    }

    if (normalizedMethod === "POST" && pathName === "/comments") {
      const currentUser = getCurrentUser(db);
      const taskId = String(bodyData.taskId || "");
      const message = String(bodyData.message || "").trim();

      if (!taskId || !message) {
        throw createError("Task and message are required.", 400);
      }

      const { task } = ensureTaskMembership(db, taskId, currentUser._id);
      const mentionedUsers = parseMentionedUsers(db, task, message);
      const timestamp = nowIso();

      const comment = {
        _id: window.pmApp.createId("comment"),
        user: currentUser._id,
        task: taskId,
        project: task.project,
        parentComment: bodyData.parentComment || null,
        message,
        mentionedUsers,
        createdAt: timestamp,
        updatedAt: timestamp
      };

      db.comments.push(comment);
      task.activity = task.activity || [];
      task.activity.push({
        type: "comment",
        message: `${currentUser.name} added a comment.`,
        user: currentUser._id,
        createdAt: timestamp
      });
      task.updatedAt = timestamp;

      createNotifications(
        db,
        uniqueValues([...(mentionedUsers || []), task.assignedTo].filter((userId) => userId && userId !== currentUser._id)),
        {
          message: `${currentUser.name} commented on "${task.title}".`,
          entityType: "comment",
          entityId: comment._id,
          type: "comment"
        }
      );

      writeDb(db);
      return populateComment(db, comment);
    }

    if (normalizedMethod === "GET" && pathName.startsWith("/comments/")) {
      const currentUser = getCurrentUser(db);
      const taskId = pathName.split("/")[2];
      ensureTaskMembership(db, taskId, currentUser._id);

      return db.comments
        .filter((comment) => comment.task === taskId)
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        .map((comment) => populateComment(db, comment));
    }

    if (normalizedMethod === "GET" && pathName === "/notifications") {
      const currentUser = getCurrentUser(db);
      return sortByNewest(
        db.notifications.filter((notification) => notification.user === currentUser._id),
        "createdAt"
      ).slice(0, 25);
    }

    if (normalizedMethod === "PUT" && pathName.startsWith("/notifications/") && pathName.endsWith("/read")) {
      const currentUser = getCurrentUser(db);
      const notificationId = pathName.split("/")[2];
      const notification = db.notifications.find(
        (entry) => entry._id === notificationId && entry.user === currentUser._id
      );

      if (!notification) {
        throw createError("Notification not found.", 404);
      }

      notification.isRead = true;
      notification.updatedAt = nowIso();
      writeDb(db);
      return { ...notification };
    }

    throw createError("Route not found.", 404);
  };

  const remoteRequest = async (path, options = {}) => {
    const { method = "GET", body, headers = {}, isFormData = false } = options;
    const finalHeaders = { ...headers };
    const token = window.pmApp.getToken();

    if (token) {
      finalHeaders.Authorization = `Bearer ${token}`;
    }

    const requestConfig = {
      method,
      headers: finalHeaders
    };

    if (body !== undefined) {
      if (isFormData) {
        requestConfig.body = body;
      } else {
        finalHeaders["Content-Type"] = "application/json";
        requestConfig.body = JSON.stringify(body);
      }
    }

    const response = await fetch(path, requestConfig);
    const raw = await response.text();
    let data = null;

    try {
      data = raw ? JSON.parse(raw) : null;
    } catch (error) {
      data = raw;
    }

    if (!response.ok) {
      const requestError = new Error(data?.message || "Request failed.");
      requestError.statusCode = response.status;
      throw requestError;
    }

    return data;
  };

  const shouldFallbackToLocal = (path, error) => {
    if (!isKnownApiPath(path)) {
      return false;
    }

    if (window.pmApp.isStaticRuntime()) {
      return true;
    }

    return (
      error?.statusCode === 404 ||
      error?.name === "TypeError" ||
      /Failed to fetch|NetworkError|Route not found/i.test(error?.message || "")
    );
  };

  const request = async (path, options = {}) => {
    if (isKnownApiPath(path) && window.pmApp.prefersLocalData()) {
      return handleLocalRequest(path, options);
    }

    try {
      return await remoteRequest(path, options);
    } catch (error) {
      if (shouldFallbackToLocal(path, error)) {
        window.pmApp.setRuntimeMode("local");
        return handleLocalRequest(path, options);
      }

      throw error;
    }
  };

  window.api = {
    request,
    get(path) {
      return request(path);
    },
    post(path, body, isFormData = false) {
      return request(path, { method: "POST", body, isFormData });
    },
    put(path, body, isFormData = false) {
      return request(path, { method: "PUT", body, isFormData });
    },
    delete(path) {
      return request(path, { method: "DELETE" });
    }
  };
})();
