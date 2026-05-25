document.addEventListener("DOMContentLoaded", () => {
  window.pmApp.redirectIfAuthenticated();

  const form = document.getElementById("loginForm");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = "Logging In...";

    try {
      const payload = {
        email: document.getElementById("email").value.trim(),
        password: document.getElementById("password").value
      };

      const response = await window.api.post("/login", payload);
      window.pmApp.setSession(response);
      window.pmApp.showToast("Welcome back. Redirecting to your workspace.", "success");
      window.pmApp.navigateTo("dashboard");
    } catch (error) {
      window.pmApp.showToast(error.message, "error");
    } finally {
      submitButton.disabled = false;
      submitButton.innerHTML = 'Log In <i class="bi bi-arrow-right-short text-lg"></i>';
    }
  });
});
