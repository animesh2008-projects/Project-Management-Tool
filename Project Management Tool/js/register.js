document.addEventListener("DOMContentLoaded", () => {
  window.pmApp.redirectIfAuthenticated();

  const form = document.getElementById("registerForm");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = "Creating Account...";

    try {
      const payload = {
        name: document.getElementById("name").value.trim(),
        email: document.getElementById("email").value.trim(),
        password: document.getElementById("password").value,
        role: document.getElementById("role").value
      };

      const response = await window.api.post("/register", payload);
      window.pmApp.setSession(response);
      window.pmApp.showToast("Account created. Welcome to FlowForge.", "success");
      window.pmApp.navigateTo("dashboard");
    } catch (error) {
      window.pmApp.showToast(error.message, "error");
    } finally {
      submitButton.disabled = false;
      submitButton.innerHTML = 'Create Account <i class="bi bi-stars text-sm"></i>';
    }
  });
});
