const express = require('express');
const auth = require('../controller/adminController');
// router setup
const router = express.Router();
router.use(express.json());
router.post("/authlogin" , auth.adminLogin);

module.exports = router;

