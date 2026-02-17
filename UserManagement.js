const role = localStorage.getItem("role");

/* =========================
   LOAD USERS
========================= */
async function loadUsers() {
  const res = await fetch("http://localhost:3000/users");
  const users = await res.json();

    // Calculate summary counts
    const totalUsers = users.length;
    const activeUsers = users.filter(u => u.status === "active").length;
    const disabledUsers = users.filter(u => u.status === "inactive").length;

    // Update UI
    document.getElementById("totalUsers").textContent = totalUsers;
    document.getElementById("activeUsers").textContent = activeUsers;
    document.getElementById("disabledUsers").textContent = disabledUsers;

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
        class="btn ${user.status === "active" ? "deactivate" : "activate"}">
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
  const res = await fetch(`http://localhost:3000/users/${id}`);
  const user = await res.json();

  document.getElementById("editUserId").value = user.id;
  document.getElementById("editFullName").value = user.fullName;
  document.getElementById("editEmail").value = user.email;
  document.getElementById("editPhone").value = user.phone || "";
  document.getElementById("editAddress").value = user.address || "";
  document.getElementById("editRole").value = user.role;

  document.getElementById("editModal").style.display = "flex";
}

function closeEditModal() {
  document.getElementById("editModal").style.display = "none";
}

async function saveEditUser() {
  const id = document.getElementById("editUserId").value;

  const data = {
    fullName: document.getElementById("editFullName").value,
    email: document.getElementById("editEmail").value,
    phone: document.getElementById("editPhone").value,
    address: document.getElementById("editAddress").value,
    role: document.getElementById("editRole").value,
  };

  await fetch(`http://localhost:3000/admin/users/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });

  closeEditModal();
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
function deleteUser(id) {
  document.getElementById("deleteUserId").value = id;
  document.getElementById("deleteModal").style.display = "flex";
}

function closeDeleteModal() {
  document.getElementById("deleteModal").style.display = "none";
}

async function confirmDeleteUser() {
  const id = document.getElementById("deleteUserId").value;

  await fetch(`http://localhost:3000/admin/users/${id}`, {
    method: "DELETE"
  });

  closeDeleteModal();
  loadUsers();
}