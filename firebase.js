import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBFO4QxmMuhKrP0X10nA3qi-JKSBtWGWK4",
  authDomain: "aquafresh-d1018.firebaseapp.com",
  databaseURL: "https://aquafresh-d1018-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "aquafresh-d1018",
  storageBucket: "aquafresh-d1018.firebasestorage.app",
  messagingSenderId: "460445469425",
  appId: "1:460445469425:web:21ffee23caece5553a7750",
  measurementId: "G-Z87T8WHHBG"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const database = getDatabase(app);