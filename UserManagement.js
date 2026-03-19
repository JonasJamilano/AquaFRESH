import { auth, db } from "./firebase.js";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  setDoc,
  getDoc,
  serverTimestamp,
  increment
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

import {
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const role = localStorage.getItem("role");
const usersCollection = collection(db, "users");

async function generateUserCustomId() {
  const counterRef = doc(db, "counters", "users");
  const snap = await getDoc(counterRef);

  if (!snap.exists()) {
    throw new Error("Users counter not found.");
  }

  const current = snap.data().lastNumber || 0;
  const newNumber = current + 1;

  await updateDoc(counterRef, {
    lastNumber: increment(1)
  });

  return `U-${String(newNumber).padStart(3, "0")}`;
}

/* =========================
   LOAD USERS
========================= */
async function loadUsers() {
  const snapshot = await getDocs(usersCollection);

  const users = [];
  snapshot.forEach(docSnap => {
    users.push({ id: docSnap.id, ...docSnap.data() });
  });

  users.sort((a, b) => {
  if (!a.customId || !b.customId) return 0;

  const numA = parseInt(a.customId.split("-")[1]);
  const numB = parseInt(b.customId.split("-")[1]);

  return numA - numB;
});

  // Summary counts
  const totalUsers = users.length;
  const activeUsers = users.filter(u => u.status === "active").length;
  const disabledUsers = users.filter(u => u.status === "inactive").length;

  document.getElementById("totalUsers").textContent = totalUsers;
  document.getElementById("activeUsers").textContent = activeUsers;
  document.getElementById("disabledUsers").textContent = disabledUsers;

  const tbody = document.querySelector(".user-table tbody");
  tbody.innerHTML = "";

  users.forEach(user => {
    const statusClass = user.status === "active" ? "success" : "danger";
    const toggleText = user.status === "active" ? "Deactivate" : "Activate";

    const row = `
      <tr data-role="${user.role}" data-status="${user.status}">
        <td>${user.customId || user.id}</td>
        <td>${user.fullName}</td>
        <td>${user.email}</td>
        <td>${user.phone || "-"}</td>
        <td>${user.address || "-"}</td>
        <td>${user.role}</td>
        <td class="status ${statusClass}">
          ${user.status}
        </td>
        <td>
          ${user.createdAt?.toDate ? 
            user.createdAt.toDate().toLocaleDateString() 
            : "-"}
        </td>
        <td class="actions">
        ${
          role !== "manager"
            ? `
              <button onclick="editUser('${user.id}')" 
                class="btn icon-btn edit" title="Edit User">
                <i class="fa-solid fa-pen-to-square"></i>
              </button>

              <button onclick="deleteUser('${user.id}')" 
                class="btn delete" title="Delete">
                🗑
              </button>
            `
            : ""
        }

              <button onclick="toggleStatus('${user.id}', '${user.status}')"
              class="btn icon-btn ${user.status === "active" ? "deactivate" : "activate"}"
              title="${toggleText}">
              <i class="fa-solid ${user.status === "active" ? "fa-ban" : "fa-check"}"></i>
              </button>
        </td>
      </tr>
    `;

    tbody.innerHTML += row;
  });
}

window.loadUsers = loadUsers;
loadUsers();

/* =========================
   SEARCH + FILTER
========================= */

const searchInput = document.getElementById("searchInput");
const roleFilter = document.getElementById("roleFilter");
const statusFilter = document.getElementById("statusFilter");

function filterTable() {
  const search = searchInput.value.toLowerCase();
  const role = roleFilter.value;
  const status = statusFilter.value;

  const rows = document.querySelectorAll(".user-table tbody tr");

  rows.forEach(row => {
    const text = row.innerText.toLowerCase();
    const rowRole = row.dataset.role;
    const rowStatus = row.dataset.status;

    const matchSearch = text.includes(search);
    const matchRole = !role || rowRole === role;
    const matchStatus = !status || rowStatus === status;

    row.style.display =
      matchSearch && matchRole && matchStatus ? "" : "none";
  });
}

/* =========================
   NEW FILTER BUTTON SYSTEM
========================= */

document.addEventListener("DOMContentLoaded", () => {

  const filterBtn = document.getElementById("filterBtn");
  const dropdown = document.getElementById("filterDropdown");

  const searchInput = document.getElementById("searchInput");
  const roleFilter = document.getElementById("roleFilter");
  const statusFilter = document.getElementById("statusFilter");

  // ✅ TOGGLE DROPDOWN
  filterBtn?.addEventListener("click", () => {
    dropdown.classList.toggle("active");
  });

  // ✅ APPLY FILTER
  document.getElementById("applyFilter")?.addEventListener("click", () => {
    filterTable();
    dropdown.classList.remove("active");
  });

  // ✅ CLEAR FILTER
  document.getElementById("clearFilter")?.addEventListener("click", () => {
    roleFilter.value = "";
    statusFilter.value = "";
    searchInput.value = "";

    filterTable();
  });

  // ✅ SEARCH (LIVE)
  searchInput?.addEventListener("input", filterTable);

  // ✅ CLICK OUTSIDE TO CLOSE (🔥 NICE UX)
  document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target) && !filterBtn.contains(e.target)) {
      dropdown.classList.remove("active");
    }
  });

});

/* =========================
   TOGGLE STATUS
========================= */
window.toggleStatus = async function (id, currentStatus) {
  const newStatus = currentStatus === "active" ? "inactive" : "active";

  await updateDoc(doc(db, "users", id), {
    status: newStatus
  });

  loadUsers();
};

/* =========================
   EDIT USER
========================= */
window.editUser = async function (id) {
  const userRef = doc(db, "users", id);
  const snap = await getDoc(userRef);

  if (!snap.exists()) return;

  const user = snap.data();

  document.getElementById("editUserId").value = id;
  document.getElementById("editFullName").value = user.fullName;
  document.getElementById("editEmail").value = user.email;
  document.getElementById("editPhone").value = user.phone || "";
  document.getElementById("editAddress").value = user.address || "";
  document.getElementById("editRole").value = user.role;

  document.getElementById("editModal").style.display = "flex";
};

window.closeEditModal = function () {
  document.getElementById("editModal").style.display = "none";
};

window.saveEditUser = async function () {
  const id = document.getElementById("editUserId").value;

  await updateDoc(doc(db, "users", id), {
    fullName: document.getElementById("editFullName").value,
    email: document.getElementById("editEmail").value,
    phone: document.getElementById("editPhone").value,
    address: document.getElementById("editAddress").value,
    role: document.getElementById("editRole").value
  });

  closeEditModal();
  loadUsers();
};

/* =========================
   CREATE USER
========================= */
window.createUser = async function () {

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

  try {
    // Create Firebase Auth account
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );

    const newUser = userCredential.user;

    // Save in Firestore
    const customId = await generateUserCustomId();

    await setDoc(doc(db, "users", newUser.uid), {
      customId,
      fullName,
      email,
      phone,
      address,
      role,
      status,
      createdAt: serverTimestamp()
    });

    clearForm();
    loadUsers();

  } catch (error) {
    alert(error.message);
  }
};

/* =========================
   DELETE USER
========================= */
window.deleteUser = function (id) {
  document.getElementById("deleteUserId").value = id;
  document.getElementById("deleteModal").style.display = "flex";
};

window.closeDeleteModal = function () {
  document.getElementById("deleteModal").style.display = "none";
};

window.confirmDeleteUser = async function () {
  const id = document.getElementById("deleteUserId").value;

  await deleteDoc(doc(db, "users", id));

  closeDeleteModal();
  loadUsers();
};

/* =========================
   CLEAR FORM
========================= */
window.clearForm = function () {
  document.getElementById("newFullName").value = "";
  document.getElementById("newEmail").value = "";
  document.getElementById("newPhone").value = "";
  document.getElementById("newAddress").value = "";
  document.getElementById("newPassword").value = "";
  document.getElementById("newRole").value = "admin";
  document.getElementById("newStatus").value = "active";
};