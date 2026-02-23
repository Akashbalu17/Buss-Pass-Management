const mongoose = require("mongoose");

const profileSchema = new mongoose.Schema(
  {
    studentName: String,
    fatherName: String,
    dob: String,
    age: Number,
    gender: String,
    studentContact: String,
    parentContact: String,
    personalEmail: String,
    collegeEmail: String,
    district: String,
    institutionType: String,
    collegeName: String,
    department: String,
    year: String,
    schoolName: String,
    standard: String,
    collegeAddress: String,
    startRoute: String,
    endRoute: String
  },
  { _id: false }
);

const studentSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String, // (later we can hash)
  profile: profileSchema,
  lastApplicationNo: String,
  lastProfileUpdatedAt: Date
});

module.exports = mongoose.model("Student", studentSchema);
