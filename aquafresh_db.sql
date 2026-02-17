-- Create Database
CREATE DATABASE IF NOT EXISTS aquafresh_db;
USE aquafresh_db;


-- USERS TABLE

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    address TEXT,
    role ENUM('superadmin','admin','manager','inspector','delivery') NOT NULL,
    status ENUM('active','inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- QUALITY CONTROL TABLES


CREATE TABLE IF NOT EXISTS inspection_batches (
    id INT AUTO_INCREMENT PRIMARY KEY,
    batch_code VARCHAR(50) NOT NULL UNIQUE,
    product_type VARCHAR(100) NOT NULL,
    location VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS inspection_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    batch_id INT NOT NULL,
    inspector_id INT NOT NULL,
    overall_status ENUM('Passed','With Issues','Rejected') NOT NULL,
    overall_remarks TEXT,
    inspection_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (batch_id) 
        REFERENCES inspection_batches(id) 
        ON DELETE CASCADE,

    FOREIGN KEY (inspector_id) 
        REFERENCES users(id) 
        ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS inspection_criteria_results (
    id INT AUTO_INCREMENT PRIMARY KEY,
    inspection_log_id INT NOT NULL,
    criteria_name VARCHAR(100) NOT NULL,
    assessment ENUM('Excellent','Acceptable','Rejected') NOT NULL,
    remarks TEXT,

    FOREIGN KEY (inspection_log_id) 
        REFERENCES inspection_logs(id) 
        ON DELETE CASCADE
);
