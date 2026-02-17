const role = localStorage.getItem("role");

/* =========================
   LOAD USERS
========================= */
async function loadUsers() {
  const res = await fetch("http://localhost:3000/users");
  const users = await res.json();

  const tbody = document.querySelector(".user-table tbody");
  tbody.innerHTML = "";

  users.forEach(user => {
    const statusClass = user.status === "active" ? "success" : "danger";
    const toggleText = user.status === "active" ? "Deactivate" : "Activate";

        const row = `
    <tr>
        <td>${user.id}</td>
        <td>${user.full_name}</td>
        <td>${user.email}</td>
        <td>${user.phone || "-"}</td>
        <td>${user.address || "-"}</td>
        <td>${user.role}</td>
        <td class="status ${statusClass}">
        ${user.status}
        </td>
        <td>${new Date(user.created_at).toLocaleDateString()}</td>
        <td class="actions">
        ${
            role !== "manager"
            ? `
                <button onclick="editUser(${user.id})" class="btn edit">Edit</button>
                <button onclick="deleteUser(${user.id})" class="btn delete" title="Delete">
                🗑
                </button>
            `
            : ""
        }
        <button onclick="toggleStatus(${user.id}, '${user.status}')"
                class="btn disable">
                ${toggleText}
        </button>
        </td>
    </tr>
    `;

    tbody.innerHTML += row;
  });
}

loadUsers();

/* =========================
   TOGGLE STATUS
========================= */
async function toggleStatus(id, currentStatus) {
  const newStatus = currentStatus === "active" ? "inactive" : "active";

  await fetch(`http://localhost:3000/admin/users/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: newStatus })
  });

  loadUsers();
}

/* =========================
   EDIT USER (TEMP SIMPLE)
========================= */
async function editUser(id) {
  const fullName = prompt("Enter new full name:");
  const email = prompt("Enter new email:");
  const phone = prompt("Enter phone number:");
  const address = prompt("Enter address:");
  const roleInput = prompt("Enter role (superadmin/admin/manager/inspector/delivery):");
  const status = prompt("Enter status (active/inactive):");

  await fetch(`http://localhost:3000/admin/users/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName,
      email,
      phone,
      address,
      role: roleInput,
      status
    })
  });

  loadUsers();
}

/* =========================
   CREATE USER (ADD USER FORM)
========================= */
async function createUser() {

  const fullName = document.getElementById("newFullName").value;
  const email = document.getElementById("newEmail").value;
  const phone = document.getElementById("newPhone").value;
  const address = document.getElementById("newAddress").value;
  const password = document.getElementById("newPassword").value;
  const role = document.getElementById("newRole").value;
  const status = document.getElementById("newStatus").value;

  if (!fullName || !email || !password) {
    alert("Please fill required fields");
    return;
  }

  await fetch("http://localhost:3000/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName,
      email,
      password,
      phone,
      address,
      role,
      status
    })
  });

  clearForm();
  loadUsers();
}


/* =========================
   CLEAR ADD USER FORM
========================= */
function clearForm() {
  document.getElementById("newFullName").value = "";
  document.getElementById("newEmail").value = "";
  document.getElementById("newPhone").value = "";
  document.getElementById("newAddress").value = "";
  document.getElementById("newPassword").value = "";
  document.getElementById("newRole").value = "admin";
  document.getElementById("newStatus").value = "active";
}


/* =========================
   DELETE USER
========================= */
async function deleteUser(id) {
  const confirmDelete = confirm("Are you sure you want to delete this user?");

  if (!confirmDelete) return;

  await fetch(`http://localhost:3000/admin/users/${id}`, {
    method: "DELETE"
  });

  loadUsers();
}