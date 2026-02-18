const express = require('express');

exports.adminLogin = (req, res) => {
    const {username , password} = req.body;
    console.log(username , password);
    res.status(200).json({message: "Admin login successful"});


}
