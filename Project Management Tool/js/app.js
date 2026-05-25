(() => {
  const STORAGE_KEYS = {
    token: "flowforge_token",
    user: "flowforge_user",
    theme: "flowforge_theme",
    activeProject: "flowforge_active_project",
    runtimeMode: "flowforge_runtime_mode",
    localDb: "flowforge_local_db"
  };

  const PAGE_MAP = {
    home: "index.html",
    login: "login.html",
    register: "register.html",
    dashboard: "dashboard.html"
  };

  const app = {
    storageKeys: STORAGE_KEYS,

    pageUrl(target) {
      return PAGE_MAP[target] || target;
    },

    navigateTo(target) {
      window.location.href = app.pageUrl(target);
    },

    getToken() {
      return localStorage.getItem(STORAGE_KEYS.token);
    },

    getUser() {
      const raw = localStorage.getItem(STORAGE_KEYS.user);
      return raw ? JSON.parse(raw) : null;
    },

    setSession(payload) {
      const user = payload?.user
        ? {
            ...payload.user,
            _id: payload.user._id || payload.user.id,
            id: payload.user.id || payload.user._id
          }
        : null;

      if (payload?.token) {
        localStorage.setItem(STORAGE_KEYS.token, payload.token);
      }

      if (user) {
        localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
      }
    },

    markStoredUserOffline() {
      try {
        const rawDb = localStorage.getItem(STORAGE_KEYS.localDb);
        const rawUser = localStorage.getItem(STORAGE_KEYS.user);

        if (!rawDb || !rawUser) {
          return;
        }

        const db = JSON.parse(rawDb);
        const sessionUser = JSON.parse(rawUser);
        const userId = sessionUser?._id || sessionUser?.id;
        const user = db.users?.find((entry) => entry._id === userId);

        if (!user) {
          return;
        }

        user.isOnline = false;
        user.lastSeen = new Date().toISOString();
        user.updatedAt = new Date().toISOString();
        localStorage.setItem(STORAGE_KEYS.localDb, JSON.stringify(db));
      } catch (error) {
        // Ignore storage cleanup failures so logout still succeeds.
      }
    },

    clearSession() {
      app.markStoredUserOffline();
      localStorage.removeItem(STORAGE_KEYS.token);
      localStorage.removeItem(STORAGE_KEYS.user);
      localStorage.removeItem(STORAGE_KEYS.activeProject);
    },

    protectRoute() {
      if (!app.getToken()) {
        app.navigateTo("login");
      }
    },

    redirectIfAuthenticated() {
      if (app.getToken()) {
        app.navigateTo("dashboard");
      }
    },

    isStaticRuntime() {
      return window.location.protocol === "file:";
    },

    prefersLocalData() {
      return app.isStaticRuntime() || localStorage.getItem(STORAGE_KEYS.runtimeMode) === "local";
    },

    setRuntimeMode(mode) {
      localStorage.setItem(STORAGE_KEYS.runtimeMode, mode);
    },

    getTheme() {
      const savedTheme = localStorage.getItem(STORAGE_KEYS.theme);
      if (savedTheme) {
        return savedTheme;
      }

      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    },

    applyTheme(theme) {
      document.documentElement.setAttribute("data-theme", theme);
      localStorage.setItem(STORAGE_KEYS.theme, theme);
      document.querySelectorAll("[data-theme-toggle] i").forEach((icon) => {
        icon.className = theme === "dark" ? "bi bi-sun" : "bi bi-moon-stars";
      });
    },

    toggleTheme() {
      const currentTheme = document.documentElement.getAttribute("data-theme") || app.getTheme();
      app.applyTheme(currentTheme === "dark" ? "light" : "dark");
    },

    bindThemeToggles() {
      document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
        button.addEventListener("click", app.toggleTheme);
      });
    },

    showToast(message, type = "info") {
      let container = document.querySelector(".toast-container");

      if (!container) {
        container = document.createElement("div");
        container.className = "toast-container";
        document.body.appendChild(container);
      }

      const toast = document.createElement("div");
      toast.className = `toast toast-${type}`;
      toast.textContent = message;
      container.appendChild(toast);

      setTimeout(() => {
        toast.remove();
      }, 3600);
    },

    escapeHtml(value = "") {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    },

    initials(name = "") {
      const parts = String(name)
        .trim()
        .split(/\s+/)
        .filter(Boolean);

      return parts
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() || "")
        .join("") || "--";
    },

    formatDate(date, options = {}) {
      if (!date) {
        return "No date";
      }

      return new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        ...options
      }).format(new Date(date));
    },

    relativeTime(date) {
      if (!date) {
        return "Just now";
      }

      const now = Date.now();
      const target = new Date(date).getTime();
      const diffMs = target - now;
      const diffMinutes = Math.round(diffMs / (1000 * 60));
      const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

      if (Math.abs(diffMinutes) < 60) {
        return formatter.format(diffMinutes, "minute");
      }

      const diffHours = Math.round(diffMinutes / 60);
      if (Math.abs(diffHours) < 24) {
        return formatter.format(diffHours, "hour");
      }

      const diffDays = Math.round(diffHours / 24);
      return formatter.format(diffDays, "day");
    },

    toInputDate(date) {
      if (!date) {
        return "";
      }

      const value = new Date(date);
      const month = `${value.getMonth() + 1}`.padStart(2, "0");
      const day = `${value.getDate()}`.padStart(2, "0");
      return `${value.getFullYear()}-${month}-${day}`;
    },

    createId(prefix = "id") {
      const uniquePart =
        globalThis.crypto?.randomUUID?.() ||
        `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;

      return `${prefix}_${uniquePart}`;
    }
  };

  window.pmApp = app;

  document.addEventListener("DOMContentLoaded", () => {
    app.applyTheme(app.getTheme());
    app.bindThemeToggles();
  });
})();
