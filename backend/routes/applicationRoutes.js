const express = require("express");
const router = express.Router();
const controller = require("../controllers/applicationController");

router.get("/", controller.getApplications);
router.post("/", controller.createApplication);

module.exports = router;