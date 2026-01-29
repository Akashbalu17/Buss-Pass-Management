const mongoose = require("mongoose");

const applicationSchema = new mongoose.Schema({
  applicationNo: {
    type: String,
    unique: true,
    required: true
  },

  studentName: { type: String, required: true },
  fatherName: String,
  dob: String,
  age: Number,
  gender: String,
  studentContact: String,
  parentContact: String,
  personalEmail: String,
  collegeEmail: String,
  collegeName: String,
  department: String,
  year: String,
  collegeAddress: String,
  startRoute: String,
  endRoute: String,

  studentPhoto: String,
  aadhaarFile: String,
  idProof: String,

  status: {
    type: String,
    default: "Pending" // Pending | Approved | Rejected
  },

  rejectionReason: {
    type: String,
    default: "" // stored only when rejected
  }

}, { timestamps: true });

module.exports = mongoose.model("Application", applicationSchema);
