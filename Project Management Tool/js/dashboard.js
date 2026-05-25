const BOARD_STATUSES = ["To Do", "In Progress", "Review", "Completed"];

const state = {
  user: null,
  projects: [],
  tasks: [],
  notifications: [],
  commentsByTask: {},
  activeProjectId: null,
  openTaskId: null,
  replyTo: null,
  socket: null
};

document.addEventListener("DOMContentLoaded", () => {
  window.pmApp.protectRoute();
  bindDashboardEvents();
  bootstrapDashboard();
});

async function bootstrapDashboard() {
  try {
    const [profileResponse, projectsResponse, notificationsResponse] = await Promise.all([
      window.api.get("/profile"),
      window.api.get("/projects"),
      window.api.get("/notifications")
    ]);

    state.user = profileResponse.user;
    localStorage.setItem("flowforge_user", JSON.stringify(profileResponse.user));
    state.projects = Array.isArray(projectsResponse) ? projectsResponse : [];
    state.notifications = Array.isArray(notificationsResponse) ? notificationsResponse : [];

    const storedProjectId = localStorage.getItem("flowforge_active_project");
    state.activeProjectId =
      storedProjectId && state.projects.some((project) => project._id === storedProjectId)
        ? storedProjectId
        : state.projects[0]?._id || null;

    renderUser();
    renderProjects();
    renderProjectSelectors();
    renderNotifications();
    renderTeamMembers();

    if (state.activeProjectId) {
      await loadTasks(state.activeProjectId);
    } else {
      renderBoard();
      renderStats();
      renderActivity();
      renderDeadlines();
    }

    await connectSocket();
  } catch (error) {
    if (/authorized|token|login/i.test(error.message)) {
      window.pmApp.clearSession();
      window.pmApp.navigateTo("login");
      return;
    }

    window.pmApp.showToast(error.message, "error");
  }
}

function bindDashboardEvents() {
  document.getElementById("logoutBtn")?.addEventListener("click", () => {
    window.pmApp.clearSession();
    window.pmApp.navigateTo("login");
  });

  document.getElementById("openProjectModalBtn")?.addEventListener("click", () => openProjectModal());
  document
    .getElementById("openProjectModalSidebarBtn")
    ?.addEventListener("click", () => openProjectModal());

  document.getElementById("openTaskModalBtn")?.addEventListener("click", () => openTaskModal());
  document
    .getElementById("openTaskModalSidebarBtn")
    ?.addEventListener("click", () => openTaskModal());

  document.getElementById("projectForm")?.addEventListener("submit", handleProjectSubmit);
  document.getElementById("taskForm")?.addEventListener("submit", handleTaskSubmit);
  document.getElementById("commentForm")?.addEventListener("submit", handleCommentSubmit);

  document.getElementById("activeProjectSelect")?.addEventListener("change", async (event) => {
    await setActiveProject(event.target.value);
  });

  document.getElementById("taskProject")?.addEventListener("change", (event) => {
    populateAssigneeOptions(event.target.value);
  });

  document.getElementById("priorityFilter")?.addEventListener("change", renderBoard);
  document.getElementById("boardSearch")?.addEventListener("input", renderBoard);

  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => closeModal(button.dataset.closeModal));
  });

  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        closeModal(backdrop.id);
      }
    });
  });

  document.getElementById("projectGrid")?.addEventListener("click", handleProjectGridClick);
  document.getElementById("boardColumns")?.addEventListener("click", handleBoardClick);
  document.getElementById("notificationList")?.addEventListener("click", handleNotificationClick);
  document.getElementById("commentList")?.addEventListener("click", handleCommentListClick);

  document.getElementById("closeTaskDrawerBtn")?.addEventListener("click", closeTaskDrawer);
  document
    .getElementById("editTaskFromDrawerBtn")
    ?.addEventListener("click", () => openTaskModal(state.openTaskId));
  document
    .getElementById("deleteTaskFromDrawerBtn")
    ?.addEventListener("click", () => deleteTask(state.openTaskId));

  document.querySelectorAll("[data-scroll-target]").forEach((button) => {
    button.addEventListener("click", () => {
      document
        .getElementById(button.dataset.scrollTarget)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });

      document.querySelectorAll(".sidebar-link").forEach((link) => {
        link.classList.toggle("is-active", link === button);
      });

      closeSidebar();
    });
  });

  document.getElementById("mobileMenuToggle")?.addEventListener("click", openSidebar);
  document.getElementById("closeSidebarBtn")?.addEventListener("click", closeSidebar);
  document.getElementById("sidebarOverlay")?.addEventListener("click", closeSidebar);
}

async function loadTasks(projectId) {
  try {
    const tasksResponse = await window.api.get(`/tasks?projectId=${projectId}`);
    state.tasks = Array.isArray(tasksResponse) ? tasksResponse : [];
    localStorage.setItem("flowforge_active_project", projectId);
    renderProjectSelectors();
    renderProjects();
    renderTeamMembers();
    renderBoard();
    renderStats();
    renderActivity();
    renderDeadlines();
    syncTaskDrawer();
  } catch (error) {
    window.pmApp.showToast(error.message, "error");
  }
}

async function setActiveProject(projectId) {
  const previousProjectId = state.activeProjectId;
  state.activeProjectId = projectId || null;

  if (state.socket && previousProjectId && previousProjectId !== projectId) {
    state.socket.emit("leave:project", previousProjectId);
  }

  if (state.socket && projectId) {
    state.socket.emit("join:project", projectId);
  }

  if (projectId) {
    await loadTasks(projectId);
  } else {
    state.tasks = [];
    renderProjectSelectors();
    renderProjects();
    renderTeamMembers();
    renderBoard();
    renderStats();
    renderActivity();
    renderDeadlines();
    closeTaskDrawer();
  }
}

function renderUser() {
  document.getElementById("userName").textContent = state.user.name;
  document.getElementById("userRole").textContent = state.user.role;
  document.getElementById("userInitials").textContent = window.pmApp.initials(state.user.name);
}

function renderProjects() {
  const projectGrid = document.getElementById("projectGrid");
  if (!projectGrid) {
    return;
  }

  if (!state.projects.length) {
    projectGrid.innerHTML = `
      <article class="surface-card p-8 text-center">
        <h3 class="text-2xl font-extrabold">Start your first project</h3>
        <p class="mt-3 project-card-copy">
          Create a workspace, invite collaborators, and then organize the board with tasks and live comments.
        </p>
        <div class="mt-6">
          <button class="primary-button" data-action="create-project">Create Project</button>
        </div>
      </article>
    `;
    return;
  }

  projectGrid.innerHTML = state.projects
    .map((project) => {
      const isActive = project._id === state.activeProjectId;
      const members = (project.members || [])
        .slice(0, 3)
        .map(
          (member) =>
            `<span class="member-badge">${window.pmApp.escapeHtml(window.pmApp.initials(member.name))}</span>`
        )
        .join("");

      return `
        <article class="project-card ${isActive ? "ring-2 ring-teal-400/70" : ""}" data-project-id="${project._id}">
          <div class="project-card-header">
            <div>
              <p class="mini-label">Project</p>
              <h3 class="text-2xl font-extrabold">${window.pmApp.escapeHtml(project.title)}</h3>
            </div>
            <div class="flex gap-2">
              <button class="theme-toggle-btn" data-action="edit-project" data-project-id="${project._id}">
                <i class="bi bi-pencil"></i>
              </button>
              ${
                String(project.owner?._id || project.owner) === String(state.user._id)
                  ? `<button class="theme-toggle-btn text-rose-500" data-action="delete-project" data-project-id="${project._id}">
                      <i class="bi bi-trash3"></i>
                    </button>`
                  : ""
              }
            </div>
          </div>
          <p class="project-card-copy">${window.pmApp.escapeHtml(project.description || "No description yet.")}</p>
          <div class="project-meta">
            <span class="status-pill"><i class="bi bi-calendar-event"></i> ${project.deadline ? window.pmApp.formatDate(project.deadline) : "No deadline"}</span>
            <span class="status-pill"><i class="bi bi-people"></i> ${(project.members || []).length} members</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <div class="flex -space-x-2">${members || '<span class="text-sm text-slate-500">Solo project</span>'}</div>
            <button class="secondary-button" data-action="open-project" data-project-id="${project._id}">
              Open Board
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderProjectSelectors() {
  const activeProjectSelect = document.getElementById("activeProjectSelect");
  const taskProjectSelect = document.getElementById("taskProject");

  const options = state.projects
    .map(
      (project) =>
        `<option value="${project._id}" ${project._id === state.activeProjectId ? "selected" : ""}>${window.pmApp.escapeHtml(project.title)}</option>`
    )
    .join("");

  if (activeProjectSelect) {
    activeProjectSelect.innerHTML = state.projects.length
      ? options
      : '<option value="">No projects available</option>';
  }

  if (taskProjectSelect) {
    taskProjectSelect.innerHTML = state.projects.length
      ? options
      : '<option value="">No projects available</option>';
  }

  populateAssigneeOptions(taskProjectSelect?.value || state.activeProjectId);
}

function renderTeamMembers() {
  const container = document.getElementById("teamMembers");
  if (!container) {
    return;
  }

  const activeProject = getActiveProject();
  if (!activeProject) {
    container.innerHTML = '<p class="empty-copy">Select or create a project to see collaborators.</p>';
    return;
  }

  container.innerHTML = (activeProject.members || [])
    .map(
      (member) => `
        <div class="online-row">
          <div class="flex items-center gap-3">
            <div class="user-chip-avatar">${window.pmApp.escapeHtml(window.pmApp.initials(member.name))}</div>
            <div>
              <p class="font-semibold">${window.pmApp.escapeHtml(member.name)}</p>
              <p class="text-xs text-slate-500 dark:text-slate-400">${window.pmApp.escapeHtml(member.email)}</p>
            </div>
          </div>
          <span class="online-dot ${member.isOnline ? "is-online" : ""}" title="${member.isOnline ? "Online" : "Offline"}"></span>
        </div>
      `
    )
    .join("");
}

function renderBoard() {
  const boardColumns = document.getElementById("boardColumns");
  const emptyState = document.getElementById("boardEmptyState");

  if (!boardColumns || !emptyState) {
    return;
  }

  const activeProject = getActiveProject();
  if (!activeProject) {
    boardColumns.innerHTML = "";
    emptyState.classList.remove("hidden");
    return;
  }

  emptyState.classList.add("hidden");
  const searchTerm = document.getElementById("boardSearch").value.trim().toLowerCase();
  const priorityFilter = document.getElementById("priorityFilter").value;

  boardColumns.innerHTML = BOARD_STATUSES.map((status) => {
    const tasks = state.tasks.filter((task) => {
      const sameStatus = task.status === status;
      const samePriority = priorityFilter ? task.priority === priorityFilter : true;
      const matchesSearch =
        !searchTerm ||
        [task.title, task.description, ...(task.labels || []), task.assignedTo?.name || ""]
          .join(" ")
          .toLowerCase()
          .includes(searchTerm);

      return sameStatus && samePriority && matchesSearch;
    });

    const cards = tasks.length
      ? tasks.map((task) => createTaskCard(task)).join("")
      : '<div class="rounded-[20px] border border-dashed border-slate-300/50 p-5 text-center text-sm text-slate-500 dark:border-slate-600/50 dark:text-slate-400">Drop tasks here</div>';

    return `
      <section class="board-column" data-status="${status}">
        <div class="board-column-header">
          <div class="board-column-title">${status}</div>
          <span class="board-column-count">${tasks.length}</span>
        </div>
        <div class="task-list" data-status="${status}">
          ${cards}
        </div>
      </section>
    `;
  }).join("");

  bindDragAndDrop();
}

function createTaskCard(task) {
  const labels = (task.labels || [])
    .slice(0, 3)
    .map((label) => `<span class="priority-pill priority-low">${window.pmApp.escapeHtml(label)}</span>`)
    .join("");
  const dueLabel = task.dueDate ? window.pmApp.formatDate(task.dueDate) : "No due date";

  return `
    <article class="task-card" draggable="true" data-task-id="${task._id}">
      <div class="task-card-header">
        <div>
          <p class="mini-label">${window.pmApp.escapeHtml(task.priority)}</p>
          <h3 class="task-title">${window.pmApp.escapeHtml(task.title)}</h3>
        </div>
        <div class="flex gap-2">
          <button class="theme-toggle-btn" data-action="edit-task" data-task-id="${task._id}">
            <i class="bi bi-pencil"></i>
          </button>
          <button class="theme-toggle-btn text-rose-500" data-action="delete-task" data-task-id="${task._id}">
            <i class="bi bi-trash3"></i>
          </button>
        </div>
      </div>
      <p class="task-card-copy">${window.pmApp.escapeHtml(task.description || "No description added yet.")}</p>
      <div class="task-meta">
        <span class="status-pill"><i class="bi bi-person"></i> ${window.pmApp.escapeHtml(task.assignedTo?.name || "Unassigned")}</span>
        <span class="status-pill"><i class="bi bi-paperclip"></i> ${(task.attachments || []).length} files</span>
        <span class="status-pill"><i class="bi bi-calendar-event"></i> ${dueLabel}</span>
      </div>
      ${labels ? `<div class="flex flex-wrap gap-2">${labels}</div>` : ""}
    </article>
  `;
}

function renderStats() {
  const totalTasks = state.tasks.length;
  const completedTasks = state.tasks.filter((task) => task.status === "Completed").length;
  const dueSoonTasks = state.tasks.filter((task) => isDueSoon(task.dueDate)).length;

  document.getElementById("projectsCount").textContent = String(state.projects.length);
  document.getElementById("tasksCount").textContent = String(totalTasks);
  document.getElementById("completedCount").textContent = String(completedTasks);
  document.getElementById("dueSoonCount").textContent = String(dueSoonTasks);
}

function renderActivity() {
  const container = document.getElementById("activityFeed");
  if (!container) {
    return;
  }

  const activities = state.tasks
    .flatMap((task) =>
      (task.activity || []).map((activity) => ({
        ...activity,
        taskTitle: task.title
      }))
    )
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 8);

  if (!activities.length) {
    container.innerHTML = '<p class="empty-copy">Recent task activity will show up here.</p>';
    return;
  }

  container.innerHTML = activities
    .map(
      (activity) => `
        <div class="timeline-item">
          <div class="flex items-center justify-between gap-3">
            <p class="font-semibold">${window.pmApp.escapeHtml(activity.taskTitle)}</p>
            <span class="text-xs text-slate-500 dark:text-slate-400">${window.pmApp.relativeTime(activity.createdAt)}</span>
          </div>
          <p class="mt-2 text-sm text-slate-600 dark:text-slate-300">${window.pmApp.escapeHtml(activity.message)}</p>
        </div>
      `
    )
    .join("");
}

function renderNotifications() {
  const container = document.getElementById("notificationList");
  if (!container) {
    return;
  }

  if (!state.notifications.length) {
    container.innerHTML = '<p class="empty-copy">Notifications will appear here.</p>';
    return;
  }

  container.innerHTML = state.notifications
    .map(
      (notification) => `
        <article class="notification-card ${notification.isRead ? "" : "is-unread"}">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="font-semibold">${window.pmApp.escapeHtml(notification.message)}</p>
              <p class="mt-2 text-xs text-slate-500 dark:text-slate-400">${window.pmApp.relativeTime(notification.createdAt)}</p>
            </div>
            ${
              notification.isRead
                ? '<span class="status-pill">Read</span>'
                : `<button class="secondary-button !px-3 !py-2" data-action="read-notification" data-notification-id="${notification._id}">Mark read</button>`
            }
          </div>
        </article>
      `
    )
    .join("");
}

function renderDeadlines() {
  const container = document.getElementById("deadlineList");
  if (!container) {
    return;
  }

  const upcomingTasks = [...state.tasks]
    .filter((task) => task.dueDate)
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
    .slice(0, 5);

  if (!upcomingTasks.length) {
    container.innerHTML = '<p class="empty-copy">Due date reminders will appear here.</p>';
    return;
  }

  container.innerHTML = upcomingTasks
    .map(
      (task) => `
        <article class="deadline-card">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="font-semibold">${window.pmApp.escapeHtml(task.title)}</p>
              <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">${window.pmApp.escapeHtml(task.assignedTo?.name || "Unassigned")}</p>
            </div>
            <span class="status-pill">${window.pmApp.formatDate(task.dueDate)}</span>
          </div>
        </article>
      `
    )
    .join("");
}

function openProjectModal(projectId = null) {
  const form = document.getElementById("projectForm");
  form.reset();
  document.getElementById("projectId").value = "";
  document.getElementById("projectModalTitle").textContent = "Create Project";

  if (projectId) {
    const project = getProjectById(projectId);
    if (project) {
      document.getElementById("projectId").value = project._id;
      document.getElementById("projectTitle").value = project.title || "";
      document.getElementById("projectDescription").value = project.description || "";
      document.getElementById("projectDeadline").value = window.pmApp.toInputDate(project.deadline);
      document.getElementById("projectMembers").value = (project.members || [])
        .map((member) => member.email)
        .join(", ");
      document.getElementById("projectModalTitle").textContent = "Edit Project";
    }
  }

  openModal("projectModal");
}

async function handleProjectSubmit(event) {
  event.preventDefault();

  const submitButton = event.target.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = "Saving...";

  const projectId = document.getElementById("projectId").value;
  const payload = {
    title: document.getElementById("projectTitle").value.trim(),
    description: document.getElementById("projectDescription").value.trim(),
    deadline: document.getElementById("projectDeadline").value || null,
    memberEmails: document.getElementById("projectMembers").value
  };

  try {
    const project = projectId
      ? await window.api.put(`/projects/${projectId}`, payload)
      : await window.api.post("/projects", payload);

    upsertProject(project);
    closeModal("projectModal");
    await setActiveProject(project._id);
    window.pmApp.showToast(projectId ? "Project updated." : "Project created.", "success");
  } catch (error) {
    window.pmApp.showToast(error.message, "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Save Project";
  }
}

function openTaskModal(taskId = null) {
  if (!state.projects.length) {
    window.pmApp.showToast("Create a project before adding tasks.", "info");
    return;
  }

  const form = document.getElementById("taskForm");
  form.reset();
  document.getElementById("taskId").value = "";
  document.getElementById("taskModalTitle").textContent = "Create Task";
  renderProjectSelectors();

  if (state.activeProjectId) {
    document.getElementById("taskProject").value = state.activeProjectId;
    populateAssigneeOptions(state.activeProjectId);
  }

  if (taskId) {
    const task = getTaskById(taskId);
    if (task) {
      document.getElementById("taskId").value = task._id;
      document.getElementById("taskProject").value = getTaskProjectId(task);
      document.getElementById("taskTitle").value = task.title || "";
      document.getElementById("taskDescription").value = task.description || "";
      document.getElementById("taskStatus").value = task.status || "To Do";
      document.getElementById("taskPriority").value = task.priority || "Medium";
      document.getElementById("taskDueDate").value = window.pmApp.toInputDate(task.dueDate);
      document.getElementById("taskLabels").value = (task.labels || []).join(", ");
      populateAssigneeOptions(getTaskProjectId(task), task.assignedTo?._id || task.assignedTo || "");
      document.getElementById("taskModalTitle").textContent = "Edit Task";
    }
  }

  openModal("taskModal");
}

async function handleTaskSubmit(event) {
  event.preventDefault();

  const submitButton = event.target.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = "Saving...";

  const taskId = document.getElementById("taskId").value;
  const formData = new FormData();
  formData.append("project", document.getElementById("taskProject").value);
  formData.append("title", document.getElementById("taskTitle").value.trim());
  formData.append("description", document.getElementById("taskDescription").value.trim());
  formData.append("assignedTo", document.getElementById("taskAssignedTo").value);
  formData.append("status", document.getElementById("taskStatus").value);
  formData.append("priority", document.getElementById("taskPriority").value);
  formData.append("dueDate", document.getElementById("taskDueDate").value);
  formData.append("labels", document.getElementById("taskLabels").value);

  const attachments = document.getElementById("taskAttachments").files;
  [...attachments].forEach((file) => formData.append("attachments", file));

  try {
    const task = taskId
      ? await window.api.put(`/tasks/${taskId}`, formData, true)
      : await window.api.post("/tasks", formData, true);

    handleTaskUpsert(task);
    closeModal("taskModal");

    if (state.activeProjectId !== getTaskProjectId(task)) {
      await setActiveProject(getTaskProjectId(task));
    } else {
      renderBoard();
      renderStats();
      renderActivity();
      renderDeadlines();
      syncTaskDrawer();
    }

    window.pmApp.showToast(taskId ? "Task updated." : "Task created.", "success");
  } catch (error) {
    window.pmApp.showToast(error.message, "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Save Task";
  }
}

async function handleCommentSubmit(event) {
  event.preventDefault();

  const taskId = document.getElementById("commentTaskId").value;
  if (!taskId) {
    window.pmApp.showToast("Open a task before posting a comment.", "info");
    return;
  }

  const submitButton = event.target.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = "Posting...";

  try {
    const comment = await window.api.post("/comments", {
      taskId,
      message: document.getElementById("commentMessage").value.trim(),
      parentComment: document.getElementById("parentCommentId").value || null
    });

    upsertComment(comment);
    document.getElementById("commentMessage").value = "";
    clearReplyContext();
    renderActivity();
    window.pmApp.showToast("Comment added.", "success");
  } catch (error) {
    window.pmApp.showToast(error.message, "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Post Comment";
  }
}

async function openTaskDrawer(taskId) {
  const task = getTaskById(taskId);
  if (!task) {
    return;
  }

  state.openTaskId = taskId;
  document.getElementById("commentTaskId").value = taskId;
  renderTaskDrawer(task);
  document.getElementById("taskDetailDrawer").classList.add("is-open");

  try {
    const comments = await window.api.get(`/comments/${taskId}`);
    state.commentsByTask[taskId] = comments;
    renderComments(taskId);
  } catch (error) {
    window.pmApp.showToast(error.message, "error");
  }
}

function closeTaskDrawer() {
  state.openTaskId = null;
  clearReplyContext();
  document.getElementById("taskDetailDrawer").classList.remove("is-open");
}

function renderTaskDrawer(task) {
  document.getElementById("detailTaskTitle").textContent = task.title;
  document.getElementById("detailTaskDescription").textContent =
    task.description || "No description provided for this task.";

  document.getElementById("detailTaskMeta").innerHTML = `
    <span class="status-pill">${window.pmApp.escapeHtml(task.status)}</span>
    <span class="status-pill">${window.pmApp.escapeHtml(task.priority)}</span>
    <span class="status-pill">Assigned: ${window.pmApp.escapeHtml(task.assignedTo?.name || "Unassigned")}</span>
    <span class="status-pill">Due: ${task.dueDate ? window.pmApp.formatDate(task.dueDate) : "No deadline"}</span>
  `;

  document.getElementById("detailTaskLabels").innerHTML = (task.labels || [])
    .map((label) => `<span class="priority-pill priority-low">${window.pmApp.escapeHtml(label)}</span>`)
    .join("");

  document.getElementById("detailTaskAttachments").innerHTML = (task.attachments || []).length
    ? `
        <div class="space-y-2">
          ${(task.attachments || [])
            .map(
              (file) => `
                <a class="secondary-button !w-full !justify-between" href="${window.pmApp.escapeHtml(file.fileUrl)}" target="_blank" rel="noreferrer">
                  <span>${window.pmApp.escapeHtml(file.fileName)}</span>
                  <i class="bi bi-box-arrow-up-right"></i>
                </a>
              `
            )
            .join("")}
        </div>
      `
    : '<p class="text-sm text-slate-500 dark:text-slate-400">No attachments yet.</p>';
}

function renderComments(taskId) {
  const commentList = document.getElementById("commentList");
  const comments = state.commentsByTask[taskId] || [];

  if (!comments.length) {
    commentList.innerHTML = '<p class="empty-copy">No comments yet. Start the conversation.</p>';
    return;
  }

  const repliesByParent = comments.reduce((accumulator, comment) => {
    const parentId = getEntityId(comment.parentComment);
    if (!parentId) {
      return accumulator;
    }

    accumulator[parentId] = accumulator[parentId] || [];
    accumulator[parentId].push(comment);
    return accumulator;
  }, {});

  const rootComments = comments.filter((comment) => !getEntityId(comment.parentComment));
  commentList.innerHTML = rootComments
    .map((comment) => renderCommentThread(comment, repliesByParent, 0))
    .join("");
}

function renderCommentThread(comment, repliesByParent, depth) {
  const replies = repliesByParent[comment._id] || [];

  return `
    <article class="comment-card ${depth ? "reply-card" : ""}">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="font-semibold">${window.pmApp.escapeHtml(comment.user?.name || "Teammate")}</p>
          <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">${window.pmApp.relativeTime(comment.createdAt)}</p>
        </div>
        <button class="secondary-button !px-3 !py-2" data-action="reply-comment" data-comment-id="${comment._id}">
          Reply
        </button>
      </div>
      <p class="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">${window.pmApp.escapeHtml(comment.message)}</p>
      ${replies.map((reply) => renderCommentThread(reply, repliesByParent, depth + 1)).join("")}
    </article>
  `;
}

function syncTaskDrawer() {
  if (!state.openTaskId) {
    return;
  }

  const task = getTaskById(state.openTaskId);
  if (!task) {
    closeTaskDrawer();
    return;
  }

  renderTaskDrawer(task);
}

async function loadSocketClient() {
  if (window.io || window.pmApp.prefersLocalData()) {
    return;
  }

  await new Promise((resolve) => {
    const existingScript = document.querySelector('script[data-socket-loader="true"]');
    if (existingScript) {
      existingScript.addEventListener("load", resolve, { once: true });
      existingScript.addEventListener("error", resolve, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "/socket.io/socket.io.js";
    script.dataset.socketLoader = "true";
    script.async = true;
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", resolve, { once: true });
    document.head.appendChild(script);
  });
}

async function connectSocket() {
  if (!window.pmApp.getToken() || window.pmApp.prefersLocalData()) {
    return;
  }

  if (!window.io) {
    await loadSocketClient();
  }

  if (!window.io) {
    return;
  }

  state.socket = window.io({
    auth: {
      token: window.pmApp.getToken()
    }
  });

  state.socket.on("connect", () => {
    if (state.activeProjectId) {
      state.socket.emit("join:project", state.activeProjectId);
    }
  });

  state.socket.on("project:updated", async (project) => {
    upsertProject(project);
    renderProjectSelectors();
    renderProjects();
    renderTeamMembers();

    if (!state.activeProjectId) {
      await setActiveProject(project._id);
    }
  });

  state.socket.on("project:deleted", async ({ projectId }) => {
    state.projects = state.projects.filter((project) => project._id !== projectId);

    if (state.activeProjectId === projectId) {
      state.activeProjectId = state.projects[0]?._id || null;
      if (state.activeProjectId) {
        await loadTasks(state.activeProjectId);
      } else {
        state.tasks = [];
        renderBoard();
        renderStats();
        renderActivity();
        renderDeadlines();
        closeTaskDrawer();
      }
    }

    renderProjectSelectors();
    renderProjects();
    renderTeamMembers();
    window.pmApp.showToast("A project was removed.", "info");
  });

  state.socket.on("task:created", (task) => {
    handleTaskUpsert(task);
    window.pmApp.showToast(`New task: ${task.title}`, "info");
  });

  state.socket.on("task:updated", (task) => {
    handleTaskUpsert(task);
  });

  state.socket.on("task:deleted", ({ taskId }) => {
    state.tasks = state.tasks.filter((task) => task._id !== taskId);
    renderBoard();
    renderStats();
    renderActivity();
    renderDeadlines();
    syncTaskDrawer();
  });

  state.socket.on("comment:added", (comment) => {
    upsertComment(comment);
  });

  state.socket.on("notification:new", (notification) => {
    state.notifications = [notification, ...state.notifications.filter((item) => item._id !== notification._id)];
    renderNotifications();
  });

  state.socket.on("presence:update", (presence) => {
    state.projects = state.projects.map((project) => ({
      ...project,
      members: (project.members || []).map((member) =>
        member._id === presence.userId
          ? {
              ...member,
              isOnline: presence.isOnline,
              lastSeen: presence.lastSeen
            }
          : member
      )
    }));

    if (state.openTaskId) {
      const openTask = getTaskById(state.openTaskId);
      if (openTask) {
        renderTaskDrawer(openTask);
      }
    }
    renderTeamMembers();
  });
}

function handleTaskUpsert(task) {
  const taskProjectId = getTaskProjectId(task);
  if (taskProjectId !== state.activeProjectId) {
    return;
  }

  const existingIndex = state.tasks.findIndex((item) => item._id === task._id);
  if (existingIndex === -1) {
    state.tasks.unshift(task);
  } else {
    state.tasks[existingIndex] = task;
  }

  renderBoard();
  renderStats();
  renderActivity();
  renderDeadlines();
  syncTaskDrawer();
}

function upsertProject(project) {
  const existingIndex = state.projects.findIndex((item) => item._id === project._id);
  if (existingIndex === -1) {
    state.projects.unshift(project);
  } else {
    state.projects[existingIndex] = project;
  }
}

function upsertComment(comment) {
  const taskId = getEntityId(comment.task);
  const existingComments = state.commentsByTask[taskId] || [];
  const existingIndex = existingComments.findIndex((item) => item._id === comment._id);

  if (existingIndex === -1) {
    existingComments.push(comment);
  } else {
    existingComments[existingIndex] = comment;
  }

  existingComments.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  state.commentsByTask[taskId] = existingComments;

  const task = getTaskById(taskId);
  if (task) {
    task.activity = task.activity || [];
    const activityExists = task.activity.some(
      (activity) =>
        activity.type === "comment" &&
        activity.createdAt === comment.createdAt &&
        activity.message === `${comment.user?.name || "A teammate"} added a comment.`
    );

    if (!activityExists) {
      task.activity.push({
        type: "comment",
        message: `${comment.user?.name || "A teammate"} added a comment.`,
        user: comment.user,
        createdAt: comment.createdAt
      });
    }
  }

  if (state.openTaskId === taskId) {
    renderComments(taskId);
  }

  renderActivity();
}

function populateAssigneeOptions(projectId, selectedAssigneeId = "") {
  const select = document.getElementById("taskAssignedTo");
  const project = getProjectById(projectId);

  if (!select) {
    return;
  }

  if (!project) {
    select.innerHTML = '<option value="">Unassigned</option>';
    return;
  }

  select.innerHTML = `
    <option value="">Unassigned</option>
    ${(project.members || [])
      .map(
        (member) =>
          `<option value="${member._id}" ${String(selectedAssigneeId) === String(member._id) ? "selected" : ""}>${window.pmApp.escapeHtml(member.name)}</option>`
      )
      .join("")}
  `;
}

function bindDragAndDrop() {
  let draggedTaskId = null;

  document.querySelectorAll(".task-card").forEach((card) => {
    card.addEventListener("dragstart", () => {
      draggedTaskId = card.dataset.taskId;
      card.classList.add("dragging");
    });

    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
    });
  });

  document.querySelectorAll(".task-list").forEach((list) => {
    list.addEventListener("dragover", (event) => {
      event.preventDefault();
      list.classList.add("dragover");
    });

    list.addEventListener("dragleave", () => {
      list.classList.remove("dragover");
    });

    list.addEventListener("drop", async (event) => {
      event.preventDefault();
      list.classList.remove("dragover");

      const nextStatus = list.dataset.status;
      const task = getTaskById(draggedTaskId);

      if (!task || task.status === nextStatus) {
        return;
      }

      try {
        const updatedTask = await window.api.put(`/tasks/${task._id}`, { status: nextStatus });
        handleTaskUpsert(updatedTask);
      } catch (error) {
        window.pmApp.showToast(error.message, "error");
      }
    });
  });
}

async function deleteProject(projectId) {
  if (!projectId || !window.confirm("Delete this project and all its tasks?")) {
    return;
  }

  try {
    await window.api.delete(`/projects/${projectId}`);
    state.projects = state.projects.filter((project) => project._id !== projectId);

    if (state.activeProjectId === projectId) {
      state.activeProjectId = state.projects[0]?._id || null;
      if (state.activeProjectId) {
        await loadTasks(state.activeProjectId);
      } else {
        state.tasks = [];
        closeTaskDrawer();
      }
    }

    renderProjectSelectors();
    renderProjects();
    renderTeamMembers();
    renderBoard();
    renderStats();
    renderActivity();
    renderDeadlines();
    window.pmApp.showToast("Project deleted.", "success");
  } catch (error) {
    window.pmApp.showToast(error.message, "error");
  }
}

async function deleteTask(taskId) {
  if (!taskId || !window.confirm("Delete this task?")) {
    return;
  }

  try {
    await window.api.delete(`/tasks/${taskId}`);
    state.tasks = state.tasks.filter((task) => task._id !== taskId);
    renderBoard();
    renderStats();
    renderActivity();
    renderDeadlines();
    if (state.openTaskId === taskId) {
      closeTaskDrawer();
    }
    window.pmApp.showToast("Task deleted.", "success");
  } catch (error) {
    window.pmApp.showToast(error.message, "error");
  }
}

function handleProjectGridClick(event) {
  const actionButton = event.target.closest("[data-action]");

  if (!actionButton) {
    return;
  }

  const projectId = actionButton.dataset.projectId;

  if (actionButton.dataset.action === "create-project") {
    openProjectModal();
  }

  if (actionButton.dataset.action === "open-project") {
    setActiveProject(projectId);
  }

  if (actionButton.dataset.action === "edit-project") {
    openProjectModal(projectId);
  }

  if (actionButton.dataset.action === "delete-project") {
    deleteProject(projectId);
  }
}

function handleBoardClick(event) {
  const actionButton = event.target.closest("[data-action]");

  if (actionButton?.dataset.action === "edit-task") {
    openTaskModal(actionButton.dataset.taskId);
    return;
  }

  if (actionButton?.dataset.action === "delete-task") {
    deleteTask(actionButton.dataset.taskId);
    return;
  }

  const taskCard = event.target.closest(".task-card");
  if (taskCard) {
    openTaskDrawer(taskCard.dataset.taskId);
  }
}

function handleNotificationClick(event) {
  const actionButton = event.target.closest("[data-action='read-notification']");
  if (!actionButton) {
    return;
  }

  const notificationId = actionButton.dataset.notificationId;
  markNotificationAsRead(notificationId);
}

async function markNotificationAsRead(notificationId) {
  try {
    const updated = await window.api.put(`/notifications/${notificationId}/read`, {});
    state.notifications = state.notifications.map((notification) =>
      notification._id === notificationId ? updated : notification
    );
    renderNotifications();
  } catch (error) {
    window.pmApp.showToast(error.message, "error");
  }
}

function handleCommentListClick(event) {
  const replyButton = event.target.closest("[data-action='reply-comment']");
  if (!replyButton) {
    return;
  }

  const taskComments = state.commentsByTask[state.openTaskId] || [];
  const comment = taskComments.find((item) => item._id === replyButton.dataset.commentId);
  if (!comment) {
    return;
  }

  state.replyTo = comment;
  document.getElementById("parentCommentId").value = comment._id;
  const replyContext = document.getElementById("replyContext");
  replyContext.classList.remove("hidden");
  replyContext.innerHTML = `
    Replying to <strong>${window.pmApp.escapeHtml(comment.user?.name || "teammate")}</strong>
    <button type="button" class="ml-3 underline" id="clearReplyBtn">Cancel</button>
  `;

  document.getElementById("clearReplyBtn").addEventListener("click", clearReplyContext, { once: true });
  document.getElementById("commentMessage").focus();
}

function clearReplyContext() {
  state.replyTo = null;
  document.getElementById("parentCommentId").value = "";
  const replyContext = document.getElementById("replyContext");
  replyContext.classList.add("hidden");
  replyContext.innerHTML = "";
}

function openModal(modalId) {
  document.getElementById(modalId)?.classList.remove("hidden");
}

function closeModal(modalId) {
  document.getElementById(modalId)?.classList.add("hidden");
}

function openSidebar() {
  document.getElementById("sidebar")?.classList.add("is-open");
  document.getElementById("sidebarOverlay")?.classList.remove("hidden");
}

function closeSidebar() {
  document.getElementById("sidebar")?.classList.remove("is-open");
  document.getElementById("sidebarOverlay")?.classList.add("hidden");
}

function getActiveProject() {
  return state.projects.find((project) => project._id === state.activeProjectId) || null;
}

function getProjectById(projectId) {
  return state.projects.find((project) => project._id === projectId) || null;
}

function getTaskById(taskId) {
  return state.tasks.find((task) => task._id === taskId) || null;
}

function getTaskProjectId(task) {
  return getEntityId(task.project);
}

function getEntityId(entity) {
  if (!entity) {
    return null;
  }

  return typeof entity === "object" ? entity._id : entity;
}

function isDueSoon(date) {
  if (!date) {
    return false;
  }

  const now = new Date();
  const dueDate = new Date(date);
  const diff = dueDate.getTime() - now.getTime();
  return diff >= 0 && diff <= 1000 * 60 * 60 * 24 * 3;
}
