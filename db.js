import mysql from "mysql2/promise";

export const db = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "Ilovedota2valorant!?", // put your MySQL password
  database: "aquafresh_db"
});