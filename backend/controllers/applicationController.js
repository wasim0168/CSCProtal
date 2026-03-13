const pool = require("../config/db");

exports.getApplications = async (req, res, next) => {
  try {
    const [rows] = await pool.query("SELECT * FROM applications ORDER BY id DESC");
    res.status(200).json(rows);
  } catch (error) {
    next(error);
  }
};

exports.createApplication = async (req, res, next) => {
  try {
    const { name, mobile, type } = req.body;

    if (!name || !mobile || !type) {
      return res.status(400).json({ message: "All fields required" });
    }

    await pool.query(
      "INSERT INTO applications (name, mobile, type) VALUES (?, ?, ?)",
      [name, mobile, type]
    );

    res.status(201).json({ message: "Application created successfully" });
  } catch (error) {
    next(error);
  }
};