const mongoose = require("mongoose");
const Admin = require("./models/Admin");

mongoose.connect("mongodb://127.0.0.1:27017/buspassDB")
  .then(async () => {
    console.log("MongoDB connected");

    const admins = [
      { username: "admin", password: "admin123" },
      { username: "teacher1", password: "teach123" },
      { username: "teacher2", password: "teach456" }
    ];

    for (let a of admins) {
      const exists = await Admin.findOne({ username: a.username });
      if (!exists) {
        await Admin.create(a);
        console.log("Created:", a.username);
      } else {
        console.log("Already exists:", a.username);
      }
    }

    console.log("Admin setup complete");
    process.exit();
  })
  .catch(err => console.log(err));
