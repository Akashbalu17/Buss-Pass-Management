const mongoose = require("mongoose");

const supportQuerySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true },
    applicationNo: { type: String, trim: true, default: "" },
    category: {
      type: String,
      enum: ["Helpdesk", "Grievances", "Feedback"],
      required: true
    },
    message: { type: String, required: true, trim: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("SupportQuery", supportQuerySchema);
