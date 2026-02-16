import mysql from "mysql2/promise";

export const db = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "StephenCurry30!", // put your MySQL password
  database: "aquafresh_db"
});