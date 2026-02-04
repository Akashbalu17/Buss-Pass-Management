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

  // 🔥 IMPORTANT
  institutionType: {
    type: String, // School | College
    required: true
  },

  // SCHOOL
  schoolName: {
    type: String,
    default: ""
  },
  standard: {
    type: String,
    default: ""
  },

  // COLLEGE
  collegeName: {
    type: String,
    default: ""
  },
  department: {
    type: String,
    default: ""
  },
  year: {
    type: String,
    default: ""
  },

  collegeAddress: String,

  startRoute: String,
  endRoute: String,

  studentPhoto: String,
  aadhaarFile: String,
  idProof: String,
  bonafide: String,

  status: {
    type: String,
    default: "Pending" // Pending | Approved | Rejected
  },

  rejectionReason: {
    type: String,
    default: ""
  }

}, { timestamps: true });

module.exports = mongoose.model("Application", applicationSchema);
