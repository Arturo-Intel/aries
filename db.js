const mysql = require('mysql2');

// Create a connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST, 
  user: process.env.DB_USER_NM, 
  password: process.env.DB_PASSWORD, 
  database: process.env.DB, 
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  //debug: true
});

// Export the pool for use in other modules
module.exports = pool.promise();