const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const session = require("express-session");
const fs = require("fs");
const path = require("path");
const svgCaptcha = require("svg-captcha");
const PDFDocument = require("pdfkit");

const Application = require("./models/Application");
const Admin = require("./models/Admin");
const Student = require("./models/student");
const SchoolUser = require("./models/SchoolUser");
const Route = require("./models/Route");
const SupportQuery = require("./models/SupportQuery");

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const rejectionReasons = [
  "Incomplete application details",
  "Invalid Aadhaar document",
  "Invalid college ID proof",
  "Photo not clear",
  "Route details incorrect",
  "College email not valid",
  "Duplicate application",
  "Age criteria not met",
  "Document mismatch",
  "Other verification issue"
];

["uploads", "uploads/photos", "uploads/aadhaar", "uploads/idproof", "uploads/bonafide"].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/uploads", express.static("uploads"));
app.use(express.static("public"));

app.use(
  session({
    secret: "buspass_secret",
    resave: false,
    saveUninitialized: false
  })
);

mongoose
  .connect("mongodb://127.0.0.1:27017/buspassDB")
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

mongoose.connection.once("open", async () => {
  try {
    await SchoolUser.collection.dropIndex("username_1");
  } catch (err) {
    if (err && err.codeName !== "IndexNotFound") {
      console.error("Failed to drop schoolusers username index:", err.message || err);
    }
  }
});


function validateCaptcha(req, userCaptcha) {
  if (!req.session.captcha) {
    return { valid: false, message: "CAPTCHA expired. Please refresh and try again." };
  }
  if (!userCaptcha || userCaptcha.trim().toUpperCase() !== req.session.captcha.toUpperCase()) {
    return { valid: false, message: "Invalid CAPTCHA. Please try again." };
  }
  delete req.session.captcha;
  return { valid: true };
}

function isAdmin(req, res, next) {
  if (!req.session.admin) return res.redirect("/admin-login");
  next();
}

function isStudent(req, res, next) {
  if (!req.session.student) return res.redirect("/student-login");
  next();
}

function isSchool(req, res, next) {
  if (!req.session.school) return res.redirect("/school-login");
  next();
}

function isStudentOrSchool(req, res, next) {
  if (req.session.student || req.session.school) return next();
  return res.redirect("/student-login");
}

function badgeClass(status) {
  if (status === "Approved") return "bg-success";
  if (status === "Rejected") return "bg-danger";
  return "bg-warning text-dark";
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getMonthMeta(dateValue) {
  const base = new Date(dateValue || Date.now());
  const year = base.getFullYear();
  const monthIndex = base.getMonth();
  const monthLabel = base.toLocaleString("en-IN", { month: "long", year: "numeric" });
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return { monthLabel, lastDay };
}

function getExpiryDate(dateValue) {
  const base = new Date(dateValue || Date.now());
  const next = new Date(base);
  next.setMonth(next.getMonth() + 1);
  return next;
}

function getYearlyExpiryDate(dateValue) {
  const base = new Date(dateValue || Date.now());
  return new Date(base.getFullYear() + 1, base.getMonth(), base.getDate());
}

function getAcademicYear(dateValue) {
  const base = new Date(dateValue || Date.now());
  const year = base.getFullYear();
  const month = base.getMonth(); // 0-11
  if (month >= 5) {
    return `${year}-${year + 1}`;
  }
  return `${year - 1}-${year}`;
}

function getAcademicYearEnd(dateValue) {
  const base = new Date(dateValue || Date.now());
  const year = base.getFullYear();
  const month = base.getMonth();
  const endYear = month >= 5 ? year + 1 : year;
  return new Date(endYear, 4, 31);
}

function getIdCardDates(data = {}) {
  const issueBase = new Date(data.idIssuedAt || data.createdAt || data.currentValidFrom || data.updatedAt || Date.now());
  const expiryBase = new Date(data.idExpiryAt || getAcademicYearEnd(issueBase));
  return { issueBase, expiryBase };
}

function computeMonthlyFare(distanceKm) {
  const distance = Number(distanceKm);
  if (!Number.isFinite(distance) || distance <= 0) return 300;
  const billableDistance = Math.min(distance, 30);

  // Distance-based monthly fare with a minimum floor.
  const raw = 150 + billableDistance * 40;
  const rounded = Math.round(raw / 10) * 10;
  return Math.max(300, Math.min(2500, rounded));
}

function extractProfilePayload(body = {}) {
  return {
    studentName: String(body.studentName || "").trim(),
    fatherName: String(body.fatherName || "").trim(),
    dob: String(body.dob || "").trim(),
    age: Number(body.age || 0) || 0,
    gender: String(body.gender || "").trim(),
    studentContact: String(body.studentContact || "").trim(),
    parentContact: String(body.parentContact || "").trim(),
    personalEmail: String(body.personalEmail || "").trim(),
    collegeEmail: String(body.collegeEmail || "").trim(),
    district: String(body.district || "").trim(),
    institutionType: String(body.institutionType || "").trim(),
    collegeName: String(body.collegeName || "").trim(),
    department: String(body.department || "").trim(),
    year: String(body.year || "").trim(),
    schoolName: String(body.schoolName || "").trim(),
    standard: String(body.standard || "").trim(),
    collegeAddress: String(body.collegeAddress || "").trim(),
    startRoute: String(body.startRoute || "").trim(),
    endRoute: String(body.endRoute || "").trim(),
    distanceKm: Number(body.distanceKm || 0) || 0
  };
}

async function generateUniqueApplicationNo() {
  let applicationNo = "";
  let exists = true;
  while (exists) {
    applicationNo = String(Math.floor(10000000 + Math.random() * 90000000));
    exists = await Application.exists({ applicationNo });
  }
  return applicationNo;
}

async function generateUniqueCode(fieldName, prefix) {
  let code = "";
  let exists = true;
  while (exists) {
    const yearPart = new Date().getFullYear().toString().slice(-2);
    const randomPart = String(Math.floor(100000 + Math.random() * 900000));
    code = `${prefix}-${yearPart}${randomPart}`;
    exists = await Application.exists({ [fieldName]: code });
  }
  return code;
}

function buildTicketPdf(doc, data) {
  const issueBase = new Date(data.currentValidFrom || data.updatedAt || data.createdAt || Date.now());
  const expiryBase = new Date(data.currentValidTo || getExpiryDate(issueBase));
  const year = issueBase.getFullYear();
  const monthIndex = issueBase.getMonth();
  const monthName = issueBase.toLocaleString("en-IN", { month: "long" });
  const lastDay = expiryBase.getDate();
  const amount = data.ticketAmount || computeMonthlyFare(data.distanceKm);

  doc.roundedRect(20, 20, 380, 560, 12).lineWidth(2).stroke("#0d6efd");

  doc.rect(20, 20, 380, 70).fill("#0d6efd");
  doc
    .fillColor("#ffffff")
    .fontSize(14)
    .font("Helvetica-Bold")
    .text("Tamil Nadu State Transport Corporation", 30, 38, { width: 360, align: "center" })
    .fontSize(11)
    .text("Student Monthly Travel Ticket", 30, 60, { width: 360, align: "center" });

  doc.fillColor("#000000");

  const photoPath = path.resolve(data.studentPhoto || "");
  if (fs.existsSync(photoPath)) {
    try {
      doc.image(photoPath, 35, 110, { width: 90, height: 110, fit: [90, 110] });
    } catch (err) {
      console.error("PDF photo load error:", err.message);
    }
  }
  doc.rect(35, 110, 90, 110).stroke("#adb5bd");

  doc.font("Helvetica-Bold").fontSize(10).text("Application No", 145, 110);
  doc.font("Helvetica").text(data.applicationNo || "-", 145, 126);

  doc.font("Helvetica-Bold").text("Bus Pass ID", 145, 143);
  doc.font("Helvetica").text(data.idNumber || "-", 145, 159);

  doc.font("Helvetica-Bold").text("Ticket No", 145, 176);
  doc.font("Helvetica").text(data.ticketNumber || "-", 145, 192);

  doc.font("Helvetica-Bold").text("Student Name", 35, 245);
  doc.font("Helvetica").text(data.studentName || "-", 35, 260, { width: 330 });

  doc.font("Helvetica-Bold").text("Institution", 35, 290);
  doc.font("Helvetica").text(data.collegeName || data.schoolName || "-", 35, 305, { width: 330 });

  doc.font("Helvetica-Bold").text("Route", 35, 335);
  doc.font("Helvetica").text(`${data.startRoute || "-"} to ${data.endRoute || "-"}`, 35, 350, { width: 330 });
  doc.font("Helvetica").text(`Distance: ${Number(data.distanceKm || 0)} km`, 35, 365, { width: 330 });

  doc.font("Helvetica-Bold").text("Monthly Amount", 35, 385);
  doc.font("Helvetica").text(`Rs ${amount}`, 35, 400);

  doc.font("Helvetica-Bold").text("Validity", 200, 385);
  doc
    .font("Helvetica")
    .text(
      `${issueBase.toLocaleDateString("en-IN")} to ${expiryBase.toLocaleDateString("en-IN")}`,
      200,
      400
    );

  doc.rect(35, 415, 330, 90).stroke("#9ec5fe");
  doc.font("Helvetica-Bold").fillColor("#0d6efd").fontSize(9).text("Conductor Verification (Tick date when used):", 42, 422);
  doc.fillColor("#000000");

  const cols = 8;
  const startX = 42;
  const startY = 438;
  const gapX = 39;
  const gapY = 16;
  for (let day = 1; day <= lastDay; day += 1) {
    const index = day - 1;
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = startX + col * gapX;
    const y = startY + row * gapY;
    doc.font("Helvetica").fontSize(7).text(String(day), x, y + 2, { width: 12, align: "right" });
    doc.rect(x + 14, y, 10, 10).stroke("#6c757d");
  }

  doc.rect(35, 515, 330, 34).fill("#e7f1ff");
  doc
    .fillColor("#084298")
    .font("Helvetica-Bold")
    .fontSize(9)
    .text("Verified by Conductor (Name / Sign): ____________________", 45, 528);

  doc
    .fillColor("#666666")
    .font("Helvetica")
    .fontSize(7)
    .text("Valid only for approved route and month. Carry this with institution ID.", 35, 555, {
      width: 330,
      align: "center"
    });
}

function buildIdCardPdf(doc, data) {
  const { issueBase, expiryBase } = getIdCardDates(data);
  const issueDate = issueBase.toLocaleDateString("en-IN");
  const expiryDate = expiryBase.toLocaleDateString("en-IN");

  doc.roundedRect(18, 18, 383, 560, 14).lineWidth(2).stroke("#0f5132");

  doc.rect(18, 18, 383, 78).fill("#14532d");
  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(13)
    .text("Tamil Nadu State Transport Corporation", 30, 42, { width: 360, align: "center" })
    .fontSize(10)
    .text("Student Bus Pass ID Card", 30, 63, { width: 360, align: "center" });

  doc.fillColor("#111111");
  const photoPath = path.resolve(data.studentPhoto || "");
  if (fs.existsSync(photoPath)) {
    try {
      doc.image(photoPath, 40, 120, { width: 95, height: 120, fit: [95, 120] });
    } catch (err) {
      console.error("ID PDF photo load error:", err.message);
    }
  }
  doc.rect(40, 120, 95, 120).stroke("#adb5bd");

  doc.font("Helvetica-Bold").fontSize(10).text("Bus Pass ID", 155, 122);
  doc.font("Helvetica").text(data.idNumber || "-", 155, 138);
  doc.font("Helvetica-Bold").text("Application No", 155, 162);
  doc.font("Helvetica").text(data.applicationNo || "-", 155, 178);
  doc.font("Helvetica-Bold").text("Student Name", 40, 264);
  doc.font("Helvetica").text(data.studentName || "-", 40, 280, { width: 330 });
  doc.font("Helvetica-Bold").text("Father / Guardian", 40, 304);
  doc.font("Helvetica").text(data.fatherName || "-", 40, 320, { width: 330 });
  doc.font("Helvetica-Bold").text("Institution", 40, 344);
  doc.font("Helvetica").text(data.collegeName || data.schoolName || "-", 40, 360, { width: 330 });
  doc.font("Helvetica-Bold").text("Route", 40, 384);
  doc.font("Helvetica").text(`${data.startRoute || "-"} to ${data.endRoute || "-"}`, 40, 400, { width: 330 });

  doc.rect(40, 438, 330, 60).fill("#e8f6ee");
  doc.fillColor("#0f5132").font("Helvetica-Bold").fontSize(10).text(`Issue Date: ${issueDate}`, 52, 456);
  doc.font("Helvetica-Bold").text(`Expiry Date: ${expiryDate}`, 52, 474);

  doc.fillColor("#666666").font("Helvetica").fontSize(8).text("Digitally generated ID card. Valid only with institutional ID proof.", 40, 532, {
    width: 330,
    align: "center"
  });
}

app.get("/generate-captcha", (req, res) => {
  let captcha;
  do {
    captcha = svgCaptcha.create({
      size: 6,
      ignoreChars: "0o1ilO",
      noise: 6,
      color: false,
      charPreset: "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
      background: "#fffdf2",
      fontSize: 62,
      width: 240,
      height: 90
    });
  } while (!(/[A-Z]/.test(captcha.text) && /\d/.test(captcha.text)));

  // Add extra "government style" overlays to make OCR harder.
  const extraLines = Array.from({ length: 4 }).map(() => {
    const x1 = Math.floor(Math.random() * 240);
    const y1 = Math.floor(Math.random() * 90);
    const x2 = Math.floor(Math.random() * 240);
    const y2 = Math.floor(Math.random() * 90);
    const strokeWidth = (Math.random() * 1.8 + 0.8).toFixed(2);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#111111" stroke-opacity="0.28" stroke-width="${strokeWidth}" />`;
  }).join("");

  const watermarks = Array.from({ length: 2 }).map(() => {
    const x = Math.floor(Math.random() * 180) + 20;
    const y = Math.floor(Math.random() * 65) + 15;
    const rotate = Math.floor(Math.random() * 40) - 20;
    return `<text x="${x}" y="${y}" font-size="14" fill="#111111" fill-opacity="0.12" transform="rotate(${rotate} ${x} ${y})">TNSTC</text>`;
  }).join("");

  const powderNoise = Array.from({ length: 130 }).map(() => {
    const cx = Math.floor(Math.random() * 240);
    const cy = Math.floor(Math.random() * 90);
    const r = (Math.random() * 0.9 + 0.2).toFixed(2);
    const opacity = (Math.random() * 0.22 + 0.06).toFixed(2);
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#000000" fill-opacity="${opacity}" />`;
  }).join("");

  // Force captcha letters/numbers into dark green.
  const darkGreenChars = captcha.data.replace(/<path fill="[^"]+"/g, '<path fill="#14532d"');

  const hardenedSvg = darkGreenChars.replace("</svg>", `${extraLines}${powderNoise}${watermarks}</svg>`);

  req.session.captcha = captcha.text.toUpperCase();

  res.json({
    captchaImage: `data:image/svg+xml;base64,${Buffer.from(hardenedSvg).toString("base64")}`
  });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const destinationMap = {
      studentPhoto: "uploads/photos",
      aadhaarFile: "uploads/aadhaar",
      idProof: "uploads/idproof",
      bonafide: "uploads/bonafide"
    };
    cb(null, destinationMap[file.fieldname] || "uploads");
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({ storage });

app.get("/", (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.set("Surrogate-Control", "no-store");
  return res.sendFile(path.resolve("public/index.html"));
});
app.get("/status", (req, res) => res.sendFile(path.resolve("public/status.html")));
app.get("/apply", (req, res) => {
  const mode = String(req.query.mode || "").trim();
  if (mode === "school") {
    if (!req.session.school) return res.redirect("/school-login");
  } else {
    if (!req.session.student && !req.session.school) return res.redirect("/student-login");
    if (req.session.school) return res.redirect("/apply?mode=school");
  }
  res.sendFile(path.resolve("public/apply.html"));
});
app.get("/student-profile", isStudent, (req, res) => res.sendFile(path.resolve("public/student-profile.html")));
app.get("/renewal-payment.html", isStudent, (req, res) => res.sendFile(path.resolve("public/renewal-payment.html")));
app.get("/student-register", (req, res) => res.sendFile(path.resolve("public/student-register.html")));
app.get("/student-login", (req, res) => res.sendFile(path.resolve("public/student-login.html")));
app.get("/student-forgot-password", (req, res) => res.sendFile(path.resolve("public/student-forgot-password.html")));
app.get("/school-login", (req, res) => res.sendFile(path.resolve("public/school-login.html")));
app.get("/school-forgot-password", (req, res) => res.sendFile(path.resolve("public/school-forgot-password.html")));
app.get("/school-profile", isSchool, (req, res) => res.sendFile(path.resolve("public/school-profile.html")));
app.get("/admin", (req, res) => res.redirect("/admin-login"));
app.get("/admin-login", (req, res) => res.sendFile(path.resolve("public/admin-login.html")));

app.post("/student-register", async (req, res) => {
  try {
    const { name, email, password, captcha } = req.body;
    const captchaCheck = validateCaptcha(req, captcha);
    if (!captchaCheck.valid) return res.status(400).send(`${captchaCheck.message} <a href="/student-register">Try again</a>`);

    const exists = await Student.findOne({ email });
    if (exists) return res.status(409).send('Email already registered. <a href="/student-login">Login</a>');

    await Student.create({ name, email, password });
    res.redirect("/student-login");
  } catch (err) {
    console.error("Student register error:", err);
    res.status(500).send('Registration failed. <a href="/student-register">Try again</a>');
  }
});

app.post("/student-login", async (req, res) => {
  try {
    const { email, password, captcha } = req.body;
    const captchaCheck = validateCaptcha(req, captcha);
    if (!captchaCheck.valid) return res.status(400).send(`${captchaCheck.message} <a href="/student-login">Try again</a>`);

    const student = await Student.findOne({ email, password });
    if (!student) return res.status(401).send('Invalid credentials. <a href="/student-login">Try again</a>');

    req.session.student = student._id.toString();
    res.redirect("/apply");
  } catch (err) {
    console.error("Student login error:", err);
    res.status(500).send("Unable to login.");
  }
});

app.post("/school-login", async (req, res) => {
  try {
    const { email, password, captcha } = req.body;
    const captchaCheck = validateCaptcha(req, captcha);
    if (!captchaCheck.valid) return res.status(400).send(`${captchaCheck.message} <a href="/school-login">Try again</a>`);

    const schoolEmail = String(email || "").trim().toLowerCase();
    const schoolUser = await SchoolUser.findOne({ email: schoolEmail, password, isActive: true });
    if (!schoolUser) return res.status(401).send('Invalid credentials. <a href="/school-login">Try again</a>');

    req.session.school = schoolUser._id.toString();
    req.session.schoolRole = schoolUser.role || "SchoolAuthority";
    req.session.schoolName = schoolUser.schoolName || "";
    res.redirect("/apply?mode=school");
  } catch (err) {
    console.error("School login error:", err);
    res.status(500).send("Unable to login.");
  }
});

app.post("/student-forgot-password", async (req, res) => {
  try {
    const { email, newPassword, captcha } = req.body;
    const captchaCheck = validateCaptcha(req, captcha);
    if (!captchaCheck.valid) {
      return res.status(400).send(`${captchaCheck.message} <a href="/student-forgot-password">Try again</a>`);
    }

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).send('Password must be at least 6 characters. <a href="/student-forgot-password">Try again</a>');
    }

    const student = await Student.findOne({ email });
    if (!student) {
      return res.status(404).send('No student account found for this email. <a href="/student-register">Register</a>');
    }

    student.password = newPassword;
    await student.save();

    res.send('Password updated successfully. <a href="/student-login">Login now</a>');
  } catch (err) {
    console.error("Forgot password error:", err);
    res.status(500).send('Unable to reset password. <a href="/student-forgot-password">Try again</a>');
  }
});

app.post("/school-forgot-password", async (req, res) => {
  try {
    const { email, newPassword, captcha } = req.body;
    const captchaCheck = validateCaptcha(req, captcha);
    if (!captchaCheck.valid) {
      return res.status(400).send(`${captchaCheck.message} <a href="/school-forgot-password">Try again</a>`);
    }

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).send('Password must be at least 6 characters. <a href="/school-forgot-password">Try again</a>');
    }

    const schoolUser = await SchoolUser.findOne({ email: String(email || "").trim().toLowerCase() });
    if (!schoolUser) {
      return res.status(404).send('No school authority account found for this email. <a href="/school-login">Login</a>');
    }

    schoolUser.password = newPassword;
    await schoolUser.save();

    res.send('Password updated successfully. <a href="/school-login">Login now</a>');
  } catch (err) {
    console.error("School forgot password error:", err);
    res.status(500).send('Unable to reset password. <a href="/school-forgot-password">Try again</a>');
  }
});

app.get("/student-logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

app.get("/school-logout", (req, res) => {
  req.session.destroy(() => res.redirect("/school-login"));
});

app.get("/student-profile-data", isStudent, async (req, res) => {
  try {
    const student = await Student.findById(req.session.student).select(
      "name email profile lastApplicationNo lastProfileUpdatedAt"
    );
    if (!student) return res.status(404).json({ error: "Student account not found" });

    const now = new Date();
    const activeAcademicYear = getAcademicYear(now);
    const applications = await Application.find({
      $or: [{ studentId: student._id }, { personalEmail: student.email }, { collegeEmail: student.email }]
    })
      .sort({ createdAt: -1 })
      .select(
        "applicationNo studentName institutionType collegeName schoolName startRoute endRoute distanceKm status rejectionReason academicYear currentValidFrom currentValidTo renewals createdAt updatedAt"
      );

    const applicationsWithFlags = applications.map((app) => {
      const validTo = app.currentValidTo ? new Date(app.currentValidTo) : null;
      const canRenew = Boolean(
        app.status === "Approved" &&
          app.academicYear &&
          app.academicYear === activeAcademicYear &&
          validTo &&
          now >= validTo
      );
      return {
        ...app.toObject(),
        canRenew,
        renewalCount: (app.renewals || []).length,
        nextRenewalEligibleAt: validTo
      };
    });

    res.json({
      student: {
        name: student.name,
        email: student.email,
        profile: student.profile || null,
        lastApplicationNo: student.lastApplicationNo || null,
        lastProfileUpdatedAt: student.lastProfileUpdatedAt || null
      },
      applications: applicationsWithFlags
    });
  } catch (err) {
    console.error("Student profile error:", err);
    res.status(500).json({ error: "Unable to load student profile" });
  }
});

app.get("/school-profile-data", isSchool, async (req, res) => {
  try {
    const now = new Date();
    const activeAcademicYear = getAcademicYear(now);
    const applications = await Application.find({ appliedById: req.session.school })
      .sort({ createdAt: -1 })
      .select(
        "applicationNo studentName institutionType collegeName schoolName startRoute endRoute distanceKm status rejectionReason academicYear currentValidFrom currentValidTo renewals createdAt updatedAt"
      );

    const applicationsWithFlags = applications.map((app) => {
      const validTo = app.currentValidTo ? new Date(app.currentValidTo) : null;
      const canRenew = Boolean(
        app.status === "Approved" &&
          app.academicYear &&
          app.academicYear === activeAcademicYear &&
          validTo &&
          now >= validTo
      );
      return {
        ...app.toObject(),
        canRenew,
        renewalCount: (app.renewals || []).length,
        nextRenewalEligibleAt: validTo
      };
    });

    res.json({
      applications: applicationsWithFlags
    });
  } catch (err) {
    console.error("School profile error:", err);
    res.status(500).json({ error: "Unable to load school profile" });
  }
});

app.get("/student/application/:applicationNo", isStudent, async (req, res) => {
  try {
    const student = await Student.findById(req.session.student).select("email");
    if (!student) return res.status(404).send("Student account not found");

    const appData = await Application.findOne({ applicationNo: req.params.applicationNo });
    if (!appData) return res.status(404).send("Application not found");

    const studentEmail = String(student.email || "").trim().toLowerCase();
    const canView = Boolean(
      (appData.studentId && appData.studentId.toString() === req.session.student) ||
        String(appData.personalEmail || "").trim().toLowerCase() === studentEmail ||
        String(appData.collegeEmail || "").trim().toLowerCase() === studentEmail
    );

    if (!canView) return res.status(403).send("You are not allowed to view this application");

    const validityText =
      appData.currentValidFrom && appData.currentValidTo
        ? `${new Date(appData.currentValidFrom).toLocaleDateString("en-IN")} to ${new Date(appData.currentValidTo).toLocaleDateString("en-IN")}`
        : "-";

    const renewalRows = (appData.renewals || [])
      .map(
        (r) => `
          <tr>
            <td>${r.renewedAt ? new Date(r.renewedAt).toLocaleDateString("en-IN") : "-"}</td>
            <td>${
              r.validFrom && r.validTo
                ? `${new Date(r.validFrom).toLocaleDateString("en-IN")} to ${new Date(r.validTo).toLocaleDateString("en-IN")}`
                : "-"
            }</td>
            <td>${escapeHtml(String(r.distanceKm || 0))} km</td>
          </tr>
        `
      )
      .join("");

    const documentButtons = [
      appData.studentPhoto
        ? `<a class="btn btn-outline-primary btn-sm" href="/${escapeHtml(appData.studentPhoto)}" target="_blank" rel="noopener">Student Photo</a>`
        : "",
      appData.aadhaarFile
        ? `<a class="btn btn-outline-primary btn-sm" href="/${escapeHtml(appData.aadhaarFile)}" target="_blank" rel="noopener">Aadhaar</a>`
        : "",
      appData.idProof
        ? `<a class="btn btn-outline-primary btn-sm" href="/${escapeHtml(appData.idProof)}" target="_blank" rel="noopener">ID Proof</a>`
        : "",
      appData.bonafide
        ? `<a class="btn btn-outline-primary btn-sm" href="/${escapeHtml(appData.bonafide)}" target="_blank" rel="noopener">Bonafide</a>`
        : ""
    ]
      .filter(Boolean)
      .join(" ");

    const paymentStatus = escapeHtml(appData.paymentStatus || "Not Paid");
    const paymentBlock = `
      <div class="card shadow-sm mb-3">
        <div class="card-body">
          <h6 class="mb-3">Payment Details</h6>
          <div class="row g-3">
            <div class="col-md-4"><div class="label">Payment Status</div><div class="value">${paymentStatus}</div></div>
            <div class="col-md-4"><div class="label">Transaction ID</div><div class="value">${escapeHtml(appData.transactionId || "-")}</div></div>
            <div class="col-md-4"><div class="label">Submitted On</div><div class="value">${
              appData.paymentSubmittedAt ? new Date(appData.paymentSubmittedAt).toLocaleDateString("en-IN") : "-"
            }</div></div>
          </div>
        </div>
      </div>
    `;

    res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Application ${escapeHtml(appData.applicationNo)}</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet" />
  <style>
    body { background: #f5f8fc; }
    .card { border: 1px solid #d9e6f8; }
    .label { color: #567; font-size: 0.8rem; text-transform: uppercase; }
    .value { font-weight: 600; }
  </style>
</head>
<body>
  <main class="container py-4">
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h1 class="h5 mb-0">Application Details</h1>
      <a href="/student-profile" class="btn btn-sm btn-outline-secondary">Back</a>
    </div>

    <div class="card shadow-sm mb-3">
      <div class="card-body">
        <div class="row g-3">
          <div class="col-md-4"><div class="label">Application No</div><div class="value">${escapeHtml(appData.applicationNo)}</div></div>
          <div class="col-md-4"><div class="label">Student Name</div><div class="value">${escapeHtml(appData.studentName || "-")}</div></div>
          <div class="col-md-4"><div class="label">Status</div><div class="value"><span class="badge ${badgeClass(appData.status)}">${escapeHtml(appData.status || "Pending")}</span></div></div>

          <div class="col-md-4"><div class="label">Father/Guardian</div><div class="value">${escapeHtml(appData.fatherName || "-")}</div></div>
          <div class="col-md-4"><div class="label">Contact</div><div class="value">${escapeHtml(appData.studentContact || "-")}</div></div>
          <div class="col-md-4"><div class="label">Parent Contact</div><div class="value">${escapeHtml(appData.parentContact || "-")}</div></div>

          <div class="col-md-4"><div class="label">Date of Birth</div><div class="value">${escapeHtml(appData.dob || "-")}</div></div>
          <div class="col-md-4"><div class="label">Age</div><div class="value">${escapeHtml(String(appData.age || "-"))}</div></div>
          <div class="col-md-4"><div class="label">Gender</div><div class="value">${escapeHtml(appData.gender || "-")}</div></div>

          <div class="col-md-4"><div class="label">Personal Email</div><div class="value">${escapeHtml(appData.personalEmail || "-")}</div></div>
          <div class="col-md-4"><div class="label">College/School Email</div><div class="value">${escapeHtml(appData.collegeEmail || "-")}</div></div>
          <div class="col-md-4"><div class="label">Institution Type</div><div class="value">${escapeHtml(appData.institutionType || "-")}</div></div>

          <div class="col-md-4"><div class="label">Institution</div><div class="value">${escapeHtml(appData.collegeName || appData.schoolName || "-")}</div></div>
          <div class="col-md-4"><div class="label">Department</div><div class="value">${escapeHtml(appData.department || "-")}</div></div>
          <div class="col-md-4"><div class="label">Year / Standard</div><div class="value">${escapeHtml(appData.year || appData.standard || "-")}</div></div>

          <div class="col-md-12"><div class="label">Address</div><div class="value">${escapeHtml(appData.collegeAddress || "-")}</div></div>

          <div class="col-md-8"><div class="label">Route</div><div class="value text-break">${escapeHtml(appData.startRoute || "-")} to ${escapeHtml(appData.endRoute || "-")}</div></div>
          <div class="col-md-4"><div class="label">Distance</div><div class="value">${escapeHtml(String(appData.distanceKm || 0))} km</div></div>

          <div class="col-md-4"><div class="label">Academic Year</div><div class="value">${escapeHtml(appData.academicYear || "-")}</div></div>
          <div class="col-md-4"><div class="label">Current Validity</div><div class="value">${validityText}</div></div>
          <div class="col-md-4"><div class="label">Submitted On</div><div class="value">${appData.createdAt ? new Date(appData.createdAt).toLocaleDateString("en-IN") : "-"}</div></div>
        </div>

        ${
          appData.status === "Rejected"
            ? `<div class="alert alert-danger mt-3 mb-0"><strong>Rejection Reason:</strong> ${escapeHtml(appData.rejectionReason || "Not provided")}</div>`
            : ""
        }
      </div>
    </div>

    <div class="card shadow-sm mb-3">
      <div class="card-body">
        <h2 class="h6">Uploaded Documents</h2>
        <div class="d-flex flex-wrap gap-2">${documentButtons || '<span class="text-muted">No documents uploaded</span>'}</div>
      </div>
    </div>

    <div class="card shadow-sm">
      <div class="card-body">
        <h2 class="h6">Renewal History</h2>
        ${
          renewalRows
            ? `<div class="table-responsive"><table class="table table-sm align-middle mb-0"><thead><tr><th>Renewed At</th><th>Validity</th><th>Distance</th></tr></thead><tbody>${renewalRows}</tbody></table></div>`
            : '<div class="text-muted">No renewals yet.</div>'
        }
      </div>
    </div>
  </main>
</body>
</html>`);
  } catch (err) {
    console.error("Student application details error:", err);
    res.status(500).send("Unable to load application details");
  }
});

app.get("/school/application/:applicationNo", isSchool, async (req, res) => {
  try {
    const appData = await Application.findOne({ applicationNo: req.params.applicationNo });
    if (!appData) return res.status(404).send("Application not found");

    const canView = Boolean(
      appData.appliedById && appData.appliedById.toString() === req.session.school
    );
    if (!canView) return res.status(403).send("You are not allowed to view this application");

    const validityText =
      appData.currentValidFrom && appData.currentValidTo
        ? `${new Date(appData.currentValidFrom).toLocaleDateString("en-IN")} to ${new Date(appData.currentValidTo).toLocaleDateString("en-IN")}`
        : "-";

    const renewalRows = (appData.renewals || [])
      .map(
        (r) => `
          <tr>
            <td>${r.renewedAt ? new Date(r.renewedAt).toLocaleDateString("en-IN") : "-"}</td>
            <td>${
              r.validFrom && r.validTo
                ? `${new Date(r.validFrom).toLocaleDateString("en-IN")} to ${new Date(r.validTo).toLocaleDateString("en-IN")}`
                : "-"
            }</td>
            <td>${escapeHtml(String(r.distanceKm || 0))} km</td>
          </tr>
        `
      )
      .join("");

    const documentButtons = [
      appData.studentPhoto
        ? `<a class="btn btn-outline-primary btn-sm" href="/${escapeHtml(appData.studentPhoto)}" target="_blank" rel="noopener">Student Photo</a>`
        : "",
      appData.aadhaarFile
        ? `<a class="btn btn-outline-primary btn-sm" href="/${escapeHtml(appData.aadhaarFile)}" target="_blank" rel="noopener">Aadhaar</a>`
        : "",
      appData.idProof
        ? `<a class="btn btn-outline-primary btn-sm" href="/${escapeHtml(appData.idProof)}" target="_blank" rel="noopener">ID Proof</a>`
        : "",
      appData.bonafide
        ? `<a class="btn btn-outline-primary btn-sm" href="/${escapeHtml(appData.bonafide)}" target="_blank" rel="noopener">Bonafide</a>`
        : ""
    ]
      .filter(Boolean)
      .join(" ");

    res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Application ${escapeHtml(appData.applicationNo)}</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet" />
  <style>
    body { background: #f5f8fc; }
    .card { border: 1px solid #d9e6f8; }
    .label { color: #567; font-size: 0.8rem; text-transform: uppercase; }
    .value { font-weight: 600; }
  </style>
</head>
<body>
  <main class="container py-4">
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h1 class="h5 mb-0">Application ${escapeHtml(appData.applicationNo)}</h1>
      <a href="/school-profile" class="btn btn-outline-secondary btn-sm">Back</a>
    </div>

    <div class="card shadow-sm mb-3">
      <div class="card-body">
        <div class="row g-3">
          <div class="col-md-4"><div class="label">Student Name</div><div class="value">${escapeHtml(appData.studentName || "-")}</div></div>
          <div class="col-md-4"><div class="label">Institution</div><div class="value">${escapeHtml(appData.collegeName || appData.schoolName || "-")}</div></div>
          <div class="col-md-4"><div class="label">Status</div><div class="value">${escapeHtml(appData.status || "-")}</div></div>
          <div class="col-md-4"><div class="label">Route</div><div class="value">${escapeHtml(appData.startRoute || "-")} to ${escapeHtml(appData.endRoute || "-")}</div></div>
          <div class="col-md-4"><div class="label">Distance</div><div class="value">${escapeHtml(String(appData.distanceKm || 0))} km</div></div>
          <div class="col-md-4"><div class="label">Validity</div><div class="value">${validityText}</div></div>
        </div>
      </div>
    </div>

    <div class="card shadow-sm mb-3">
      <div class="card-body">
        <h2 class="h6">Uploaded Documents</h2>
        <div class="d-flex flex-wrap gap-2">${documentButtons || '<span class="text-muted">No documents uploaded</span>'}</div>
      </div>
    </div>

    <div class="card shadow-sm">
      <div class="card-body">
        <h2 class="h6">Renewal History</h2>
        ${
          renewalRows
            ? `<div class="table-responsive"><table class="table table-sm align-middle mb-0"><thead><tr><th>Renewed At</th><th>Validity</th><th>Distance</th></tr></thead><tbody>${renewalRows}</tbody></table></div>`
            : '<div class="text-muted">No renewals yet.</div>'
        }
      </div>
    </div>
  </main>
</body>
</html>`);
  } catch (err) {
    console.error("School application details error:", err);
    res.status(500).send("Unable to load application details");
  }
});
app.post("/support-query", async (req, res) => {
  try {
    const { name, email, applicationNo, category, message } = req.body;

    if (!name || !email || !category || !message) {
      return res.status(400).json({ error: "All required fields must be filled." });
    }

    if (!["Helpdesk", "Grievances", "Feedback"].includes(category)) {
      return res.status(400).json({ error: "Invalid query category." });
    }

    await SupportQuery.create({
      name: String(name).trim(),
      email: String(email).trim(),
      applicationNo: String(applicationNo || "").trim(),
      category,
      message: String(message).trim()
    });

    res.json({ success: true, message: "Query submitted successfully." });
  } catch (err) {
    console.error("Support query error:", err);
    res.status(500).json({ error: "Unable to submit query right now. Please try again." });
  }
});

app.post(
  "/apply",
  isStudentOrSchool,
  upload.fields([
    { name: "studentPhoto", maxCount: 1 },
    { name: "aadhaarFile", maxCount: 1 },
    { name: "idProof", maxCount: 1 },
    { name: "bonafide", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const studentId = req.session.student || null;
      const isSchoolUser = Boolean(req.session.school);
      const returnPath = isSchoolUser ? "/apply?mode=school" : "/apply";
      const captchaCheck = validateCaptcha(req, req.body.captcha);
      if (!captchaCheck.valid) {
        return res.status(400).send(`${captchaCheck.message} <a href="${returnPath}">Try again</a>`);
      }

      const hasRequiredFiles =
        req.files &&
        req.files.studentPhoto &&
        req.files.aadhaarFile &&
        req.files.idProof &&
        req.files.bonafide;

      if (!hasRequiredFiles) {
        return res.status(400).send(`Please upload all required documents. <a href="${returnPath}">Try again</a>`);
      }

      const distanceKm = Number(req.body.distanceKm);
      if (!Number.isFinite(distanceKm) || distanceKm <= 0 || distanceKm > 30) {
        return res.status(400).send(`Distance must be between 1 and 30 km only. <a href="${returnPath}">Try again</a>`);
      }
      req.body.distanceKm = distanceKm;

      const startRoute = String(req.body.startRoute || "").trim();
      const endRoute = String(req.body.endRoute || "").trim();
      const matchedRoute = await Route.findOne({
        startPoint: startRoute,
        endPoint: endRoute,
        distanceKm,
        isActive: true
      }).select("fare");
      if (!matchedRoute) {
        return res
          .status(400)
          .send(`Selected route is not authorized. Please choose a valid route. <a href="${returnPath}">Try again</a>`);
      }

      let applicationNo = String(req.body.applicationNo || "").trim();
      if (!/^\d{8}$/.test(applicationNo)) {
        applicationNo = await generateUniqueApplicationNo();
      } else {
        const appNoExists = await Application.exists({ applicationNo });
        if (appNoExists) applicationNo = await generateUniqueApplicationNo();
      }

      let idNumber = await generateUniqueCode("idNumber", "BPID");
      let ticketNumber = await generateUniqueCode("ticketNumber", "BPTK");
      while (ticketNumber === idNumber) {
        ticketNumber = await generateUniqueCode("ticketNumber", "BPTK");
      }

      const profilePayload = extractProfilePayload(req.body);
      req.body.district = String(req.body.district || profilePayload.district || "").trim();
      const academicYear = getAcademicYear();
      const appliedById = isSchoolUser ? req.session.school : null;
      const appliedByRole = isSchoolUser ? (req.session.schoolRole || "SchoolAuthority") : null;
      const schoolVerificationStatus = isSchoolUser ? "Verified" : null;
      const schoolVerifiedAt = isSchoolUser ? new Date() : null;
      const schoolVerifiedBy = isSchoolUser ? req.session.school : null;
      // Retry once if a duplicate key race happens.
      let createdApplication = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          createdApplication = await Application.create({
            ...req.body,
            district: req.body.district || profilePayload.district || "",
            studentId,
            submittedByType: isSchoolUser ? "School" : "Student",
            appliedById,
            appliedByRole,
            schoolVerificationStatus,
            schoolVerifiedBy,
            schoolVerifiedAt,
            applicationNo,
            idNumber,
            ticketNumber,
            academicYear,
            ticketAmount: matchedRoute ? matchedRoute.fare : computeMonthlyFare(distanceKm),
            studentPhoto: req.files.studentPhoto[0].path,
            aadhaarFile: req.files.aadhaarFile[0].path,
            idProof: req.files.idProof[0].path,
            bonafide: req.files.bonafide[0].path
          });
          break;
        } catch (createErr) {
          const isDuplicate = createErr && createErr.code === 11000;
          if (!isDuplicate || attempt === 2) throw createErr;
          applicationNo = await generateUniqueApplicationNo();
          idNumber = await generateUniqueCode("idNumber", "BPID");
          ticketNumber = await generateUniqueCode("ticketNumber", "BPTK");
          while (ticketNumber === idNumber) {
            ticketNumber = await generateUniqueCode("ticketNumber", "BPTK");
          }
        }
      }

      try {
        if (studentId) {
          await Student.findByIdAndUpdate(studentId, {
            $set: {
              profile: profilePayload,
              lastApplicationNo: createdApplication ? createdApplication.applicationNo : applicationNo,
              lastProfileUpdatedAt: new Date()
            }
          });
        }
      } catch (profileErr) {
        console.error("Profile save warning:", profileErr);
      }

      res.redirect(`/application-success.html?appNo=${encodeURIComponent(applicationNo)}`);
    } catch (err) {
      console.error("Apply error:", err);
      if (err && err.code === 11000) {
        return res.status(409).send(`A duplicate ID was generated. Please submit again. <a href="${returnPath}">Try again</a>`);
      }
      res.status(500).send(`Error submitting application. <a href="${returnPath}">Try again</a>`);
    }
  }
);

app.get("/check-status/:applicationNo", async (req, res) => {
  try {
    const appData = await Application.findOne({ applicationNo: req.params.applicationNo });
    if (!appData) return res.status(404).json({ error: "Application not found" });

    res.json({
      applicationNo: appData.applicationNo,
      studentName: appData.studentName,
      status: appData.status || "Pending",
      rejectionReason: appData.rejectionReason || null,
      canDownloadTicket: appData.status === "Approved"
    });
  } catch (err) {
    console.error("Check status error:", err);
    res.status(500).json({ error: "Unable to fetch application status" });
  }
});

app.get("/application-summary/:applicationNo", async (req, res) => {
  try {
    const appData = await Application.findOne({ applicationNo: req.params.applicationNo }).select(
      "applicationNo institutionType ticketAmount distanceKm paymentStatus renewalPaymentStatus renewalTransactionId"
    );
    if (!appData) return res.status(404).json({ error: "Application not found" });
    const isCollege = String(appData.institutionType || "").toLowerCase() === "college";
    res.json({
      applicationNo: appData.applicationNo,
      institutionType: appData.institutionType || "",
      paymentRequired: isCollege,
      ticketAmount: appData.ticketAmount || computeMonthlyFare(appData.distanceKm || 0),
      paymentStatus: appData.paymentStatus || "Not Paid",
      renewalPaymentStatus: appData.renewalPaymentStatus || "Not Paid",
      renewalTransactionId: appData.renewalTransactionId || ""
    });
  } catch (err) {
    console.error("Application summary error:", err);
    res.status(500).json({ error: "Unable to fetch application summary" });
  }
});

app.post("/admin-login", async (req, res) => {
  try {
    const { username, password, captcha } = req.body;
    const captchaCheck = validateCaptcha(req, captcha);
    if (!captchaCheck.valid) return res.status(400).send(`${captchaCheck.message} <a href="/admin-login">Try again</a>`);

    const admin = await Admin.findOne({ username, password });
    if (!admin) return res.status(401).send('Invalid credentials. <a href="/admin-login">Try again</a>');

    req.session.admin = true;
    res.redirect("/admin-dashboard");
  } catch (err) {
    console.error("Admin login error:", err);
    res.status(500).send("Unable to login.");
  }
});

app.get("/routes", async (req, res) => {
  try {
    const routes = await Route.find({ isActive: true }).sort({ startPoint: 1, endPoint: 1 });
    res.json(
      routes.map((r) => ({
        id: r._id.toString(),
        startPoint: r.startPoint,
        endPoint: r.endPoint,
        distanceKm: r.distanceKm,
        fare: r.fare
      }))
    );
  } catch (err) {
    console.error("Routes list error:", err);
    res.status(500).json({ error: "Unable to load routes" });
  }
});

app.post("/admin/routes", isAdmin, async (req, res) => {
  try {
    const startPoint = String(req.body.startPoint || "").trim();
    const endPoint = String(req.body.endPoint || "").trim();
    const distanceKm = Number(req.body.distanceKm);
    const fare = Number(req.body.fare);
    const isActive = req.body.isActive ? true : false;

    if (!startPoint || !endPoint || !Number.isFinite(distanceKm) || !Number.isFinite(fare)) {
      return res.redirect("/admin-dashboard#routes-section");
    }

    if (distanceKm <= 0 || distanceKm > 30 || fare < 0) {
      return res.redirect("/admin-dashboard#routes-section");
    }

    const districtCodeMap = {
      ariyalur: "ARY",
      chengalpattu: "CPT",
      chennai: "CHN",
      coimbatore: "CBE",
      cuddalore: "CDL",
      dharmapuri: "DMP",
      dindigul: "DGL",
      erode: "ERD",
      kallakurichi: "KKI",
      kanchipuram: "KPM",
      karur: "KRR",
      krishnagiri: "KGI",
      madurai: "MDU",
      mayiladuthurai: "MYD",
      nagapattinam: "NGP",
      nilgiris: "NLG",
      perambalur: "PMB",
      pudukkottai: "PDK",
      ramanathapuram: "RMD",
      ranipet: "RPT",
      salem: "SLM",
      sivaganga: "SVG",
      tenkasi: "TKS",
      thanjavur: "TNJ",
      theni: "THN",
      thoothukudi: "TUT",
      tiruchirappalli: "TPJ",
      tirunelveli: "TNV",
      tirupathur: "TPT",
      tiruppur: "TUP",
      tiruvallur: "TRL",
      tiruvannamalai: "TVM",
      tiruvarur: "TVR",
      vellore: "VLR",
      viluppuram: "VPM",
      virudhunagar: "VNR"
    };
    const normalizedStart = startPoint.trim();
    const routeCode = districtCodeMap[normalizedStart.toLowerCase()] ||
      normalizedStart
        .split(/\s+/)
        .join("")
        .slice(0, 3)
        .toUpperCase();
    const code = routeCode || "RTE";
    const existingCount = await Route.countDocuments({ routeId: new RegExp(`^${code}\\(R\\d{3}\\)$`, "i") });
    const nextSeq = String(existingCount + 1).padStart(3, "0");
    const routeId = `${code}(R${nextSeq})`;

    await Route.create({ routeId, startPoint, endPoint, distanceKm, fare, isActive });
    res.redirect("/admin-dashboard#routes-section");
  } catch (err) {
    console.error("Create route error:", err);
    res.redirect("/admin-dashboard#routes-section");
  }
});

app.post("/admin/routes/:id", isAdmin, async (req, res) => {
  try {
    const startPoint = String(req.body.startPoint || "").trim();
    const endPoint = String(req.body.endPoint || "").trim();
    const distanceKm = Number(req.body.distanceKm);
    const fare = Number(req.body.fare);
    const isActive = req.body.isActive ? true : false;

    if (!startPoint || !endPoint || !Number.isFinite(distanceKm) || !Number.isFinite(fare)) {
      return res.redirect("/admin-dashboard#routes-section");
    }

    if (distanceKm <= 0 || distanceKm > 30 || fare < 0) {
      return res.redirect("/admin-dashboard#routes-section");
    }

    await Route.findByIdAndUpdate(req.params.id, { startPoint, endPoint, distanceKm, fare, isActive });
    res.redirect("/admin-dashboard#routes-section");
  } catch (err) {
    console.error("Update route error:", err);
    res.redirect("/admin-dashboard#routes-section");
  }
});

app.post("/admin/routes/:id/delete", isAdmin, async (req, res) => {
  try {
    await Route.findByIdAndDelete(req.params.id);
    res.redirect("/admin-dashboard#routes-section");
  } catch (err) {
    console.error("Delete route error:", err);
    res.redirect("/admin-dashboard#routes-section");
  }
});

app.post("/admin/schools", isAdmin, async (req, res) => {
  try {
    const { schoolName, district, email, password, role } = req.body;
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!schoolName || !district || !normalizedEmail || !password) {
      return res.redirect("/admin-dashboard#school-authority");
    }

    const exists = await SchoolUser.findOne({ email: normalizedEmail });
    if (exists) return res.redirect("/admin-dashboard#school-authority");

    await SchoolUser.create({
      schoolName: String(schoolName).trim(),
      district: String(district).trim(),
      email: normalizedEmail,
      password: String(password),
      role: String(role || "SchoolAuthority").trim(),
      isActive: true
    });
    res.redirect("/admin-dashboard#school-authority");
  } catch (err) {
    console.error("Create school authority error:", err);
    res.redirect("/admin-dashboard#school-authority");
  }
});

app.post("/admin/schools/:id/toggle", isAdmin, async (req, res) => {
  try {
    const school = await SchoolUser.findById(req.params.id);
    if (!school) return res.redirect("/admin-dashboard#school-authority");
    school.isActive = !school.isActive;
    await school.save();
    res.redirect("/admin-dashboard#school-authority");
  } catch (err) {
    console.error("Toggle school authority error:", err);
    res.redirect("/admin-dashboard#school-authority");
  }
});

app.post("/admin/schools/:id/delete", isAdmin, async (req, res) => {
  try {
    await SchoolUser.findByIdAndDelete(req.params.id);
    res.redirect("/admin-dashboard#school-authority");
  } catch (err) {
    console.error("Delete school authority error:", err);
    res.redirect("/admin-dashboard#school-authority");
  }
});

app.get("/admin-dashboard", isAdmin, async (req, res) => {
  const apps = await Application.find().sort({ createdAt: -1 });
  const total = apps.length;
  const approved = apps.filter((a) => a.status === "Approved").length;
  const rejected = apps.filter((a) => a.status === "Rejected").length;
  const pending = apps.filter((a) => a.status === "Pending").length;
  const now = new Date();
  const backfillMsg =
    req.query.backfill === "done"
      ? "Validity fields backfilled."
      : req.query.backfill === "districts"
        ? "Districts backfilled for existing applications."
        : req.query.backfill === "fares"
          ? "Route fares backfilled for existing applications."
          : "";

  const studentIds = Array.from(
    new Set(
      apps
        .map((a) => (a.studentId ? a.studentId.toString() : ""))
        .filter(Boolean)
    )
  );
  const students = studentIds.length
    ? await Student.find({ _id: { $in: studentIds } }).select("_id profile.district")
    : [];
  const studentDistrictMap = students.reduce((acc, s) => {
    acc[s._id.toString()] = String(s?.profile?.district || "").trim();
    return acc;
  }, {});

  const appEmails = Array.from(
    new Set(
      apps
        .flatMap((a) => [String(a.personalEmail || "").trim().toLowerCase(), String(a.collegeEmail || "").trim().toLowerCase()])
        .filter(Boolean)
    )
  );
  const studentsByEmail = appEmails.length
    ? await Student.find({ $or: [{ email: { $in: appEmails } }, { "profile.personalEmail": { $in: appEmails } }, { "profile.collegeEmail": { $in: appEmails } }] })
        .select("email profile.district profile.personalEmail profile.collegeEmail")
    : [];
  const studentDistrictByEmail = studentsByEmail.reduce((acc, s) => {
    const district = String(s?.profile?.district || "").trim();
    const email = String(s.email || "").trim().toLowerCase();
    const personal = String(s?.profile?.personalEmail || "").trim().toLowerCase();
    const college = String(s?.profile?.collegeEmail || "").trim().toLowerCase();
    if (email) acc[email] = district;
    if (personal) acc[personal] = district;
    if (college) acc[college] = district;
    return acc;
  }, {});

  function getAppDistrict(appData) {
    const appDistrict = String(appData.district || "").trim();
    if (appDistrict) return appDistrict;
    const sid = appData.studentId ? appData.studentId.toString() : "";
    const profileDistrict = sid ? String(studentDistrictMap[sid] || "").trim() : "";
    if (profileDistrict) return profileDistrict;
    const personalEmail = String(appData.personalEmail || "").trim().toLowerCase();
    const collegeEmail = String(appData.collegeEmail || "").trim().toLowerCase();
    return studentDistrictByEmail[personalEmail] || studentDistrictByEmail[collegeEmail] || "Not Specified";
  }

  const institutionStats = apps.reduce(
    (acc, a) => {
      const type = String(a.institutionType || "").trim().toLowerCase();
      if (type === "college") acc.college += 1;
      else if (type === "school") acc.school += 1;
      else acc.other += 1;
      return acc;
    },
    { college: 0, school: 0, other: 0 }
  );

  const genderStats = apps.reduce(
    (acc, a) => {
      const gender = String(a.gender || "").trim().toLowerCase();
      if (["male", "boy", "boys"].includes(gender)) acc.boys += 1;
      else if (["female", "girl", "girls"].includes(gender)) acc.girls += 1;
      else acc.other += 1;
      return acc;
    },
    { boys: 0, girls: 0, other: 0 }
  );

  const districtMap = apps.reduce((acc, a) => {
    const district = getAppDistrict(a);
    const key = district.toLowerCase();
    if (!acc[key]) {
      acc[key] = { district, total: 0, approved: 0, pending: 0, rejected: 0 };
    }
    acc[key].total += 1;
    if (a.status === "Approved") acc[key].approved += 1;
    if (a.status === "Pending") acc[key].pending += 1;
    if (a.status === "Rejected") acc[key].rejected += 1;
    return acc;
  }, {});

  const districtRows = Object.values(districtMap)
    .filter((d) => String(d.district || "").trim().toLowerCase() !== "not specified")
    .sort((a, b) => b.total - a.total || a.district.localeCompare(b.district))
    .map(
      (d) => `
        <tr>
          <td>${escapeHtml(d.district)}</td>
          <td>${d.total}</td>
          <td><span class="badge bg-success-subtle text-success-emphasis">${d.approved}</span></td>
          <td><span class="badge bg-warning-subtle text-warning-emphasis">${d.pending}</span></td>
          <td><span class="badge bg-danger-subtle text-danger-emphasis">${d.rejected}</span></td>
        </tr>
      `
    )
    .join("");

  const districtRevenueMap = apps.reduce((acc, a) => {
    const isCollege = String(a.institutionType || "").toLowerCase() === "college";
    if (!isCollege || a.paymentStatus !== "Verified") return acc;
    const district = getAppDistrict(a);
    const key = district.toLowerCase();
    if (!acc[key]) {
      acc[key] = { district, revenue: 0, passes: 0 };
    }
    const baseFare = computeMonthlyFare(a.distanceKm || 0);
    const renewalCount = Array.isArray(a.renewals) ? a.renewals.length : 0;
    acc[key].revenue += baseFare * (1 + renewalCount);
    acc[key].passes += 1;
    return acc;
  }, {});

  const districtRevenueList = Object.values(districtRevenueMap).sort(
    (a, b) => b.revenue - a.revenue || a.district.localeCompare(b.district)
  );
  const districtRevenueOptions = districtRevenueList
    .map((d) => `<option value="${escapeHtml(d.district)}">${escapeHtml(d.district)}</option>`)
    .join("");
  const districtRevenueJson = JSON.stringify(
    districtRevenueList.map((d) => ({ district: d.district, revenue: d.revenue, passes: d.passes }))
  );

  const statusChartJson = JSON.stringify({
    labels: ["Approved", "Pending", "Rejected"],
    values: [approved, pending, rejected]
  });

  const institutionChartJson = JSON.stringify({
    labels: ["College", "School", "Other"],
    values: [institutionStats.college, institutionStats.school, institutionStats.other]
  });

  const topDistricts = Object.values(districtMap)
    .filter((d) => String(d.district || "").trim().toLowerCase() !== "not specified")
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);
  const districtChartJson = JSON.stringify({
    labels: topDistricts.map((d) => d.district),
    values: topDistricts.map((d) => d.total)
  });

  const monthBuckets = apps.reduce((acc, a) => {
    const date = new Date(a.createdAt);
    const label = date.toLocaleString("en-IN", { month: "short", year: "numeric" });
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
  const trendLabels = Object.keys(monthBuckets).slice(-6);
  const trendChartJson = JSON.stringify({
    labels: trendLabels,
    values: trendLabels.map((label) => monthBuckets[label] || 0)
  });

  const recentActivityRows = apps
    .slice(0, 7)
    .map((a) => {
      const statusLabel =
        a.status === "Approved"
          ? "approved"
          : a.status === "Rejected"
            ? "rejected"
            : "submitted";
      return `
        <li class="recent-item">
          <div class="fw-semibold">${escapeHtml(a.studentName || "-")} ${statusLabel}</div>
          <div class="small text-muted">
            App ${escapeHtml(a.applicationNo || "-")} • ${escapeHtml(getAppDistrict(a))} • ${new Date(
              a.createdAt
            ).toLocaleDateString("en-IN")}
          </div>
        </li>
      `;
    })
    .join("");

  const schoolUsers = await SchoolUser.find().sort({ createdAt: -1 });
  const activeSchools = schoolUsers.filter((u) => u.isActive).length;
  const inactiveSchools = schoolUsers.length - activeSchools;
  const schoolRows = schoolUsers
    .map(
      (u) => `
        <tr>
          <td>${escapeHtml(u.schoolName || "-")}</td>
          <td>${escapeHtml(u.district || "-")}</td>
          <td>${escapeHtml(u.email || "-")}</td>
          <td>${escapeHtml(u.role || "-")}</td>
          <td><span class="badge ${u.isActive ? "bg-success" : "bg-secondary"}">${u.isActive ? "Active" : "Inactive"}</span></td>
          <td class="text-nowrap">
            <form method="POST" action="/admin/schools/${u._id}/toggle" class="d-inline">
              <button type="submit" class="btn btn-sm btn-outline-primary">${u.isActive ? "Deactivate" : "Activate"}</button>
            </form>
            <form method="POST" action="/admin/schools/${u._id}/delete" class="d-inline ms-1">
              <button type="submit" class="btn btn-sm btn-outline-danger">Delete</button>
            </form>
          </td>
        </tr>
      `
    )
    .join("");

  const institutionMap = apps.reduce((acc, a) => {
    const type = String(a.institutionType || "").trim();
    const name = String(a.collegeName || a.schoolName || "").trim();
    if (!name) return acc;
    const key = `${type}::${name}`.toLowerCase();
    if (!acc[key]) {
      acc[key] = {
        type: type || "Unknown",
        name,
        district: getAppDistrict(a),
        total: 0,
        approved: 0,
        pending: 0,
        rejected: 0
      };
    }
    acc[key].total += 1;
    if (a.status === "Approved") acc[key].approved += 1;
    if (a.status === "Pending") acc[key].pending += 1;
    if (a.status === "Rejected") acc[key].rejected += 1;
    return acc;
  }, {});

  const institutionRows = Object.values(institutionMap)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .map(
      (i) => `
        <tr>
          <td>${escapeHtml(i.name)}</td>
          <td>${escapeHtml(i.type || "-")}</td>
          <td>${escapeHtml(i.district || "-")}</td>
          <td>${i.total}</td>
          <td><span class="badge bg-success-subtle text-success-emphasis">${i.approved}</span></td>
          <td><span class="badge bg-warning-subtle text-warning-emphasis">${i.pending}</span></td>
          <td><span class="badge bg-danger-subtle text-danger-emphasis">${i.rejected}</span></td>
        </tr>
      `
    )
    .join("");

  const approvedApps = apps.filter((a) => a.status === "Approved");
  const idGenRows = approvedApps
    .map(
      (a) => `
        <tr>
          <td>${escapeHtml(a.applicationNo)}</td>
          <td>${escapeHtml(a.studentName)}</td>
          <td>${escapeHtml(a.collegeName || a.schoolName || "-")}</td>
          <td>${escapeHtml(a.institutionType || "-")}</td>
          <td>${new Date(a.createdAt).toLocaleDateString("en-IN")}</td>
          <td class="text-nowrap">
            <a href="/bus-pass-id/${encodeURIComponent(a.applicationNo)}" class="btn btn-sm btn-success" target="_blank">View ID</a>
            <a href="/bus-ticket/${encodeURIComponent(a.applicationNo)}" class="btn btn-sm btn-info text-white" target="_blank">View Ticket</a>
          </td>
        </tr>
      `
    )
    .join("");

  const admins = await Admin.find().select("username");
  const adminRows = admins
    .map((a) => `<tr><td>${escapeHtml(a.username)}</td><td>Admin</td><td>Active</td></tr>`)
    .join("");

  const studentRows = (await Student.find().select("name email"))
    .map((s) => `<tr><td>${escapeHtml(s.name || "-")}</td><td>${escapeHtml(s.email || "-")}</td><td>Student</td></tr>`)
    .join("");

  const schoolUserRows = schoolUsers
    .map(
      (u) =>
        `<tr><td>${escapeHtml(u.email || "-")}</td><td>${escapeHtml(u.schoolName || "-")}</td><td>${u.isActive ? "Active" : "Inactive"}</td></tr>`
    )
    .join("");

  const routeDemandMap = apps.reduce((acc, a) => {
    const start = String(a.startRoute || "").trim();
    const end = String(a.endRoute || "").trim();
    const distance = Number(a.distanceKm || 0);
    if (!start || !end || !Number.isFinite(distance)) return acc;
    const key = `${start}||${end}||${distance}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const routes = await Route.find().sort({ startPoint: 1, endPoint: 1 });
  const activeRoutes = routes.filter((r) => r.isActive).length;
  const demandThresholds = { high: 20, moderate: 10 };
  const demandSummary = { high: 0, moderate: 0, low: 0, none: 0 };
  const districtOptions = [
    "Ariyalur",
    "Chengalpattu",
    "Chennai",
    "Coimbatore",
    "Cuddalore",
    "Dharmapuri",
    "Dindigul",
    "Erode",
    "Kallakurichi",
    "Kanchipuram",
    "Karur",
    "Krishnagiri",
    "Madurai",
    "Mayiladuthurai",
    "Nagapattinam",
    "Nilgiris",
    "Perambalur",
    "Pudukkottai",
    "Ramanathapuram",
    "Ranipet",
    "Salem",
    "Sivaganga",
    "Tenkasi",
    "Thanjavur",
    "Theni",
    "Thoothukudi",
    "Tiruchirappalli",
    "Tirunelveli",
    "Tirupathur",
    "Tiruppur",
    "Tiruvallur",
    "Tiruvannamalai",
    "Tiruvarur",
    "Vellore",
    "Viluppuram",
    "Virudhunagar"
  ];
  const routeCityOptions = districtOptions
    .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
    .join("");
  const routeRows = routes
    .map((r, idx) => {
      const checked = r.isActive ? "checked" : "";
      const formId = `routeForm-${idx}`;
      const demandKey = `${r.startPoint}||${r.endPoint}||${Number(r.distanceKm || 0)}`;
      const demand = routeDemandMap[demandKey] || 0;
      let demandLabel = "None";
      let demandClass = "text-bg-secondary";
      if (demand >= demandThresholds.high) {
        demandLabel = "High";
        demandClass = "text-bg-danger";
        demandSummary.high += 1;
      } else if (demand >= demandThresholds.moderate) {
        demandLabel = "Moderate";
        demandClass = "text-bg-warning";
        demandSummary.moderate += 1;
      } else if (demand > 0) {
        demandLabel = "Low";
        demandClass = "text-bg-success";
        demandSummary.low += 1;
      } else {
        demandSummary.none += 1;
      }
      return `
        <tr data-start="${escapeHtml(r.startPoint || "")}" data-end="${escapeHtml(r.endPoint || "")}">
          <td>${escapeHtml(r.routeId || "-")}</td>
          <td><input class="form-control form-control-sm" form="${formId}" name="startPoint" value="${escapeHtml(
            r.startPoint || ""
          )}" required></td>
          <td><input class="form-control form-control-sm" form="${formId}" name="endPoint" value="${escapeHtml(
            r.endPoint || ""
          )}" required></td>
          <td><input class="form-control form-control-sm" form="${formId}" type="number" name="distanceKm" step="0.1" min="1" max="30" value="${escapeHtml(
            String(r.distanceKm || "")
          )}" required></td>
          <td><input class="form-control form-control-sm" form="${formId}" type="number" name="fare" step="1" min="0" value="${escapeHtml(
            String(r.fare || "")
          )}" required></td>
          <td class="text-center"><span class="badge text-bg-light">${demand}</span></td>
          <td class="text-center"><span class="badge ${demandClass}">${demandLabel}</span></td>
          <td class="text-center">
            <input class="form-check-input" form="${formId}" type="checkbox" name="isActive" ${checked}>
          </td>
          <td class="text-nowrap">
            <form id="${formId}" method="POST" action="/admin/routes/${r._id}">
              <div class="d-flex gap-1">
                <button type="submit" class="btn btn-sm btn-outline-primary">Update</button>
                <button type="submit" formaction="/admin/routes/${r._id}/delete" class="btn btn-sm btn-outline-danger">Delete</button>
              </div>
            </form>
          </td>
        </tr>
      `;
    })
    .join("");

  const rows = apps
    .map(
      (a) => `
      <tr>
        <td class="d-none app-type-cell">${escapeHtml(a.institutionType || "-")}</td>
        <td>${escapeHtml(a.applicationNo)}</td>
        <td>${escapeHtml(a.studentName)}</td>
        <td>${escapeHtml(getAppDistrict(a))}</td>
        <td>${escapeHtml(a.gender || "-")}</td>
        <td>${escapeHtml(a.collegeName || a.schoolName || "-")}</td>
        <td>${escapeHtml(a.institutionType || "-")}</td>
        <td><span class="badge ${badgeClass(a.status)}">${escapeHtml(a.status)}</span></td>
        <td>${escapeHtml(String((a.renewals || []).length))}</td>
        <td>${new Date(a.createdAt).toLocaleDateString("en-IN")}</td>
        <td class="text-nowrap">
          <a href="/admin/application/${a._id}" class="btn btn-sm btn-primary">Review</a>
          ${
            a.status === "Approved"
              ? `
                <a href="/bus-pass-id/${encodeURIComponent(a.applicationNo)}" class="btn btn-sm btn-success" target="_blank">View ID</a>
                <a href="/bus-ticket/${encodeURIComponent(a.applicationNo)}" class="btn btn-sm btn-info text-white" target="_blank">View Ticket</a>
              `
              : ""
          }
        </td>
      </tr>
    `
    )
    .join("");

  const collegeRows = apps
    .filter((a) => String(a.institutionType || "").toLowerCase() === "college")
    .map(
      (a) => `
      <tr>
        <td>${escapeHtml(a.applicationNo)}</td>
        <td>${escapeHtml(a.studentName)}</td>
        <td>${escapeHtml(getAppDistrict(a))}</td>
        <td>${escapeHtml(a.gender || "-")}</td>
        <td>${escapeHtml(a.collegeName || "-")}</td>
        <td><span class="badge ${badgeClass(a.status)}">${escapeHtml(a.status)}</span></td>
        <td>${escapeHtml(String((a.renewals || []).length))}</td>
        <td>${new Date(a.createdAt).toLocaleDateString("en-IN")}</td>
        <td class="text-nowrap">
          <a href="/admin/application/${a._id}" class="btn btn-sm btn-primary">Review</a>
          ${
            a.status === "Approved"
              ? `
                <a href="/bus-pass-id/${encodeURIComponent(a.applicationNo)}" class="btn btn-sm btn-success" target="_blank">View ID</a>
                <a href="/bus-ticket/${encodeURIComponent(a.applicationNo)}" class="btn btn-sm btn-info text-white" target="_blank">View Ticket</a>
              `
              : ""
          }
        </td>
      </tr>
    `
    )
    .join("");

  const schoolAppRows = apps
    .filter((a) => String(a.institutionType || "").toLowerCase() === "school")
    .map(
      (a) => `
      <tr>
        <td>${escapeHtml(a.applicationNo)}</td>
        <td>${escapeHtml(a.studentName)}</td>
        <td>${escapeHtml(getAppDistrict(a))}</td>
        <td>${escapeHtml(a.gender || "-")}</td>
        <td>${escapeHtml(a.schoolName || "-")}</td>
        <td><span class="badge ${badgeClass(a.status)}">${escapeHtml(a.status)}</span></td>
        <td>${escapeHtml(String((a.renewals || []).length))}</td>
        <td>${new Date(a.createdAt).toLocaleDateString("en-IN")}</td>
        <td class="text-nowrap">
          <a href="/admin/application/${a._id}" class="btn btn-sm btn-primary">Review</a>
          ${
            a.status === "Approved"
              ? `
                <a href="/bus-pass-id/${encodeURIComponent(a.applicationNo)}" class="btn btn-sm btn-success" target="_blank">View ID</a>
                <a href="/bus-ticket/${encodeURIComponent(a.applicationNo)}" class="btn btn-sm btn-info text-white" target="_blank">View Ticket</a>
              `
              : ""
          }
        </td>
      </tr>
    `
    )
    .join("");

  res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Admin Dashboard</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet" />
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet" />
  <style>
    body {
      background:
        radial-gradient(circle at 12% 12%, #dceeff 0%, transparent 34%),
        radial-gradient(circle at 86% 84%, #ddf8ea 0%, transparent 34%),
        linear-gradient(130deg, #f3f8ff 0%, #f7fcf8 100%);
      min-height: 100vh;
    }
    .dash-top {
      background: linear-gradient(135deg, #0b5132 0%, #14613f 100%);
      color: #fff;
      box-shadow: 0 10px 24px rgba(12, 72, 47, 0.3);
    }
    .kpi-card {
      border: 1px solid #d6e3f3;
      border-radius: 14px;
      box-shadow: 0 12px 26px rgba(16, 58, 104, 0.08);
    }
    .kpi-icon {
      width: 42px;
      height: 42px;
      border-radius: 10px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 1.1rem;
      background: #eef4fb;
      color: #264a6e;
    }
    .panel {
      border: 1px solid #d8e5f5;
      border-radius: 14px;
      box-shadow: 0 12px 24px rgba(16, 58, 104, 0.08);
      background: #fff;
    }
    .mini-kpi {
      border-radius: 12px;
      border: 1px solid #dce7f4;
      background: #f8fbff;
      padding: 0.9rem;
    }
    .small-title {
      font-size: 0.78rem;
      letter-spacing: 0.04em;
      color: #57718e;
      text-transform: uppercase;
      font-weight: 700;
    }
    .small-value {
      font-size: 1.4rem;
      font-weight: 800;
      color: #18324f;
      line-height: 1.1;
    }
    .layout-shell {
      display: flex;
      min-height: 100vh;
    }
    .sidebar {
      width: 280px;
      background: linear-gradient(180deg, #12392b 0%, #0d2d22 100%);
      color: #e8f5ee;
      border-right: 1px solid rgba(255, 255, 255, 0.12);
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
      flex-shrink: 0;
      transition: margin-left 0.25s ease, transform 0.25s ease;
    }
    .sidebar .brand {
      font-size: 1.35rem;
      font-weight: 800;
      letter-spacing: 0.02em;
      padding: 1.1rem 1.15rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.15);
    }
    .gov-head {
      padding: 1rem 1rem 0.85rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.15);
    }
    .gov-title {
      font-size: 1.45rem;
      font-weight: 800;
      line-height: 1.1;
      margin-bottom: 0.2rem;
    }
    .gov-sub {
      color: #b8d9ca;
      font-size: 0.82rem;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      font-weight: 700;
    }
    .admin-profile {
      padding: 0.95rem 1rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.15);
      display: flex;
      align-items: center;
      gap: 0.85rem;
    }
    .admin-avatar {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 1.2rem;
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.3);
    }
    .sidebar .nav-link {
      color: #d8efe4;
      border-radius: 10px;
      padding: 0.65rem 0.8rem;
      display: flex;
      align-items: center;
      gap: 0.65rem;
      font-weight: 600;
    }
    .sidebar .nav-link:hover {
      background: rgba(255, 255, 255, 0.12);
      color: #fff;
    }
    .sidebar .nav-link.active {
      background: rgba(255, 255, 255, 0.2);
      color: #fff;
    }
    .content-wrap {
      flex: 1;
      min-width: 0;
    }
    .layout-shell.sidebar-collapsed .sidebar {
      margin-left: -280px;
    }
    .sidebar-toggle {
      border: 1px solid rgba(255, 255, 255, 0.45);
      color: #fff;
      background: rgba(255, 255, 255, 0.1);
    }
    .sidebar-toggle:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.2);
    }
    .recent-item {
      list-style: none;
      border-bottom: 1px solid #e8eef6;
      padding: 0.65rem 0;
    }
    .recent-item:last-child {
      border-bottom: 0;
      padding-bottom: 0;
    }
    .report-card {
      border: 1px solid #dbe8f7;
      border-radius: 14px;
      background: #ffffff;
      box-shadow: 0 10px 24px rgba(16, 58, 104, 0.08);
    }
    .report-title {
      font-size: 0.92rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #1f3d4d;
    }
    .chart-box {
      padding: 0.75rem;
      border-radius: 12px;
      background: #f8fbff;
      border: 1px solid #e2e8f5;
      height: 240px;
    }
    .chart-box.pie-small {
      height: 180px;
      max-width: 220px;
      margin: 0 auto;
    }
    @media (max-width: 992px) {
      .layout-shell {
        display: block;
      }
      .sidebar {
        width: 280px;
        height: 100vh;
        position: fixed;
        left: 0;
        top: 0;
        z-index: 1050;
        margin-left: 0;
      }
      .layout-shell.sidebar-collapsed .sidebar {
        transform: translateX(-100%);
      }
    }
  </style>
</head>
<body>
  <div class="layout-shell sidebar-collapsed" id="adminLayout">
    <aside class="sidebar">
      <div class="gov-head">
        <div class="gov-title"><i class="bi bi-bank2 me-2"></i>Government of Tamil Nadu</div>
        <div class="gov-sub">Bus Pass Management</div>
      </div>
      <div class="admin-profile">
        <span class="admin-avatar"><i class="bi bi-person-gear"></i></span>
        <div>
          <div class="fw-semibold">Admin</div>
          <div class="small text-light opacity-75">System Administrator</div>
        </div>
      </div>
      <div class="p-3">
        <nav class="nav flex-column gap-1">
          <a class="nav-link active" href="#dashboard-section" data-section-link="dashboard-section"><i class="bi bi-speedometer2"></i>Dashboard</a>
          <a class="nav-link" href="#college-applications-section" data-section-link="college-applications-section"><i class="bi bi-mortarboard"></i>College Applications</a>
          <a class="nav-link" href="#school-authority" data-section-link="school-authority"><i class="bi bi-building-check"></i>School Authority</a>
          <a class="nav-link" href="#school-applications-section" data-section-link="school-applications-section"><i class="bi bi-building"></i>School Applications</a>
          <a class="nav-link" href="#routes-section" data-section-link="routes-section"><i class="bi bi-signpost-split"></i>Routes</a>
          <a class="nav-link" href="#institutions-section" data-section-link="institutions-section"><i class="bi bi-buildings"></i>Institutions</a>
          <a class="nav-link" href="#reports-section" data-section-link="reports-section"><i class="bi bi-bar-chart-line"></i>Reports</a>
          <a class="nav-link" href="#id-generation-section" data-section-link="id-generation-section"><i class="bi bi-person-vcard"></i>ID Generation</a>
          <a class="nav-link" href="#users-section" data-section-link="users-section"><i class="bi bi-people"></i>Users</a>
          <a class="nav-link" href="#settings-section" data-section-link="settings-section"><i class="bi bi-gear"></i>Settings</a>
          <a class="nav-link" href="/logout"><i class="bi bi-box-arrow-right"></i>Logout</a>
        </nav>
      </div>
    </aside>

    <div class="content-wrap">
      <nav class="navbar navbar-expand-lg dash-top">
        <div class="container-fluid px-3 px-md-4">
          <button type="button" class="btn btn-sm sidebar-toggle me-2" id="sidebarToggle" aria-label="Toggle sidebar">
            <i class="bi bi-chevron-right" id="sidebarToggleIcon"></i>
          </button>
          <span class="navbar-brand fw-semibold"><i class="bi bi-speedometer2 me-2"></i>Bus Pass Admin Dashboard</span>
          <a href="/logout" class="btn btn-light btn-sm">Logout</a>
        </div>
      </nav>

      <main class="container-fluid py-4 px-3 px-md-4">
        ${backfillMsg ? `<div class="alert alert-success">${backfillMsg}</div>` : ""}

        <section id="dashboard-section" class="section-panel">
        <div class="row g-3 mb-4" id="kpi-section">
          <div class="col-sm-6 col-xl-3">
            <div class="kpi-card bg-white p-3 h-100">
              <div class="d-flex align-items-center gap-3">
                <span class="kpi-icon"><i class="bi bi-file-earmark-text"></i></span>
                <div><div class="small-title">Total Applications</div><div class="h3 mb-0">${total}</div></div>
              </div>
            </div>
          </div>
          <div class="col-sm-6 col-xl-3">
            <div class="kpi-card bg-white p-3 h-100">
              <div class="d-flex align-items-center gap-3">
                <span class="kpi-icon text-success"><i class="bi bi-patch-check"></i></span>
                <div><div class="small-title">Approved</div><div class="h3 mb-0 text-success">${approved}</div></div>
              </div>
            </div>
          </div>
          <div class="col-sm-6 col-xl-3">
            <div class="kpi-card bg-white p-3 h-100">
              <div class="d-flex align-items-center gap-3">
                <span class="kpi-icon text-warning"><i class="bi bi-hourglass-split"></i></span>
                <div><div class="small-title">Pending</div><div class="h3 mb-0 text-warning">${pending}</div></div>
              </div>
            </div>
          </div>
          <div class="col-sm-6 col-xl-3">
            <div class="kpi-card bg-white p-3 h-100">
              <div class="d-flex align-items-center gap-3">
                <span class="kpi-icon text-danger"><i class="bi bi-x-octagon"></i></span>
                <div><div class="small-title">Rejected</div><div class="h3 mb-0 text-danger">${rejected}</div></div>
              </div>
            </div>
          </div>
        </div>

        <div class="row g-3 mb-4">
          <div class="col-xl-8">
            <div class="row g-3">
              <div class="col-lg-6" id="institutions-section">
                <div class="panel p-3 h-100">
                  <div class="d-flex align-items-center justify-content-between mb-2">
                    <h6 class="mb-0"><i class="bi bi-buildings me-2"></i>Institution Split</h6>
                    <span class="badge text-bg-light">School vs College</span>
                  </div>
                  <div class="mini-kpi mb-2">
                    <div class="small-title">College</div>
                    <div class="small-value text-primary">${institutionStats.college}</div>
                  </div>
                  <div class="mini-kpi mb-2">
                    <div class="small-title">School</div>
                    <div class="small-value text-success">${institutionStats.school}</div>
                  </div>
                  <div class="mini-kpi">
                    <div class="small-title">Other / Not Set</div>
                    <div class="small-value text-secondary">${institutionStats.other}</div>
                  </div>
                </div>
              </div>

              <div class="col-lg-6" id="users-section">
                <div class="panel p-3 h-100">
                  <div class="d-flex align-items-center justify-content-between mb-2">
                    <h6 class="mb-0"><i class="bi bi-gender-ambiguous me-2"></i>Gender Split</h6>
                    <span class="badge text-bg-light">Boys / Girls</span>
                  </div>
                  <div class="mini-kpi mb-2">
                    <div class="small-title">Boys</div>
                    <div class="small-value text-info">${genderStats.boys}</div>
                  </div>
                  <div class="mini-kpi mb-2">
                    <div class="small-title">Girls</div>
                    <div class="small-value text-danger">${genderStats.girls}</div>
                  </div>
                  <div class="mini-kpi">
                    <div class="small-title">Other / Not Set</div>
                    <div class="small-value text-secondary">${genderStats.other}</div>
                  </div>
                </div>
              </div>

              <div class="col-12" id="district-section">
                <div class="panel p-3 h-100">
                  <div class="d-flex align-items-center justify-content-between mb-2">
                    <h6 class="mb-0"><i class="bi bi-geo-alt me-2"></i>District Wise Summary</h6>
                    <span class="badge text-bg-light">${Object.keys(districtMap).length} Districts</span>
                  </div>
                  <div class="table-responsive">
                    <table class="table table-sm align-middle mb-0">
                      <thead class="table-light">
                        <tr>
                          <th>District</th>
                          <th>Total</th>
                          <th>A</th>
                          <th>P</th>
                          <th>R</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${districtRows || '<tr><td colspan="5" class="text-center text-muted py-3">No data</td></tr>'}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="col-xl-4">
            <div class="panel p-3 mb-3" id="revenue-section">
              <div class="d-flex align-items-center justify-content-between mb-2">
                <h6 class="mb-0"><i class="bi bi-cash-coin me-2"></i>Total Revenue By District</h6>
              </div>
              <div class="mb-2">
                <label class="small text-muted mb-1">Select District</label>
                <select class="form-select form-select-sm" id="districtRevenueSelect">
                  <option value="">All Districts</option>
                  ${districtRevenueOptions}
                </select>
              </div>
              <div class="mini-kpi mb-2">
                <div class="small-title">Revenue</div>
                <div class="small-value text-success" id="districtRevenueValue">Rs 0</div>
              </div>
              <div class="small text-muted" id="districtRevenueMeta">0 approved passes counted</div>
            </div>

            <div class="panel p-3">
              <div class="d-flex align-items-center justify-content-between mb-2">
                <h6 class="mb-0"><i class="bi bi-clock-history me-2"></i>Recent Activity</h6>
                <span class="badge text-bg-light">${Math.min(apps.length, 7)} items</span>
              </div>
              <ul class="ps-0 mb-0">
                ${recentActivityRows || '<li class="recent-item text-muted">No recent activity</li>'}
              </ul>
            </div>
          </div>
        </div>
        </section>

        <section id="reports-section" class="section-panel d-none">
        <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
          <h5 class="mb-0"><i class="bi bi-bar-chart-line me-2"></i>Reports & Analytics</h5>
          <span class="badge text-bg-light">${total} Applications</span>
        </div>

        <div class="row g-3 mb-4">
          <div class="col-xl-3 col-md-6">
            <div class="report-card p-3 h-100">
              <div class="report-title mb-2"><i class="bi bi-pie-chart me-2"></i>Status Distribution</div>
              <div class="chart-box pie-small">
                <canvas id="statusChart"></canvas>
              </div>
            </div>
          </div>
          <div class="col-xl-3 col-md-6">
            <div class="report-card p-3 h-100">
              <div class="report-title mb-2"><i class="bi bi-diagram-3 me-2"></i>School vs College</div>
              <div class="chart-box pie-small">
                <canvas id="institutionChart"></canvas>
              </div>
            </div>
          </div>
          <div class="col-xl-6">
            <div class="report-card p-3 h-100">
              <div class="report-title mb-2"><i class="bi bi-bar-chart me-2"></i>District-wise Demand</div>
              <div class="chart-box">
                <canvas id="districtChart"></canvas>
              </div>
            </div>
          </div>
        </div>

        <div class="row g-3">
          <div class="col-xl-8">
            <div class="report-card p-3 h-100">
              <div class="report-title mb-2"><i class="bi bi-graph-up-arrow me-2"></i>Submission Trend (Last 6 Months)</div>
              <div class="chart-box">
                <canvas id="trendChart"></canvas>
              </div>
            </div>
          </div>
          <div class="col-xl-4">
            <div class="report-card p-3 h-100">
              <div class="report-title mb-2"><i class="bi bi-cash-coin me-2"></i>Revenue Snapshot</div>
              <div class="chart-box">
                <canvas id="revenueChart"></canvas>
              </div>
            </div>
          </div>
        </div>
        </section>

        <section id="school-authority" class="section-panel d-none">
        <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
          <h5 class="mb-0"><i class="bi bi-building-check me-2"></i>School Authority Management</h5>
          <div class="d-flex gap-2">
            <span class="badge text-bg-success">Active: ${activeSchools}</span>
            <span class="badge text-bg-secondary">Inactive: ${inactiveSchools}</span>
          </div>
        </div>

        <div class="panel mb-4">
          <div class="card-body p-3">
            <form class="row g-2 align-items-end" method="POST" action="/admin/schools">
              <div class="col-md-3">
                <label class="form-label small text-muted">School Name</label>
                <input type="text" class="form-control form-control-sm" name="schoolName" required>
              </div>
              <div class="col-md-2">
                <label class="form-label small text-muted">District</label>
                <input type="text" class="form-control form-control-sm" name="district" required>
              </div>
              <div class="col-md-3">
                <label class="form-label small text-muted">Official Email</label>
                <input type="email" class="form-control form-control-sm" name="email" required>
              </div>
              <div class="col-md-2">
                <label class="form-label small text-muted">Password</label>
                <input type="password" class="form-control form-control-sm" name="password" required>
              </div>
              <div class="col-md-2">
                <label class="form-label small text-muted">Role</label>
                <input type="text" class="form-control form-control-sm" name="role" value="SchoolAuthority">
              </div>
              <div class="col-md-2">
                <button type="submit" class="btn btn-sm btn-success w-100">Create</button>
              </div>
            </form>
          </div>
        </div>

        <div class="panel mb-4">
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead class="table-light">
                <tr>
                  <th>School Name</th>
                  <th>District</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>${schoolRows || '<tr><td colspan="6" class="text-center py-4">No school authorities found</td></tr>'}</tbody>
            </table>
          </div>
        </div>
        </section>

        <section id="college-applications-section" class="section-panel d-none">
        <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
          <h5 class="mb-0"><i class="bi bi-mortarboard me-2"></i>College Applications</h5>
          <div class="d-flex gap-2">
            <button type="button" class="btn btn-outline-secondary btn-sm" id="id-generation-section"><i class="bi bi-person-vcard me-1"></i>ID Generation</button>
            <button type="button" class="btn btn-outline-secondary btn-sm" id="settings-section"><i class="bi bi-gear me-1"></i>Settings</button>
            <form method="POST" action="/admin/backfill-validity">
              <button type="submit" class="btn btn-outline-primary btn-sm"><i class="bi bi-arrow-repeat me-1"></i>Backfill Validity</button>
            </form>
            <form method="POST" action="/admin/backfill-districts">
              <button type="submit" class="btn btn-outline-primary btn-sm"><i class="bi bi-geo-alt me-1"></i>Backfill Districts</button>
            </form>
            <form method="POST" action="/admin/backfill-route-fares">
              <button type="submit" class="btn btn-outline-primary btn-sm"><i class="bi bi-currency-rupee me-1"></i>Backfill Route Fares</button>
            </form>
          </div>
        </div>

        <div class="panel">
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead class="table-light">
                <tr>
                  <th>Application No</th>
                  <th>Student</th>
                  <th>District</th>
                  <th>Gender</th>
                  <th>Institution</th>
                  <th>Status</th>
                  <th>Renewals</th>
                  <th>Submitted</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>${collegeRows || '<tr><td colspan="9" class="text-center py-4">No college applications found</td></tr>'}</tbody>
            </table>
          </div>
        </div>
        </section>

        <section id="school-applications-section" class="section-panel d-none">
        <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
          <h5 class="mb-0"><i class="bi bi-building me-2"></i>School Applications</h5>
        </div>

        <div class="panel">
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead class="table-light">
                <tr>
                  <th>Application No</th>
                  <th>Student</th>
                  <th>District</th>
                  <th>Gender</th>
                  <th>Institution</th>
                  <th>Status</th>
                  <th>Renewals</th>
                  <th>Submitted</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>${schoolAppRows || '<tr><td colspan="9" class="text-center py-4">No school applications found</td></tr>'}</tbody>
            </table>
          </div>
        </div>
        </section>

        <section id="routes-section" class="section-panel d-none">
        <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
          <h5 class="mb-0"><i class="bi bi-signpost-split me-2"></i>Route Management</h5>
          <div class="d-flex gap-2 flex-wrap">
            <span class="badge text-bg-success">${activeRoutes} Active</span>
            <span class="badge text-bg-danger">High: ${demandSummary.high}</span>
            <span class="badge text-bg-warning">Moderate: ${demandSummary.moderate}</span>
            <span class="badge text-bg-success">Low: ${demandSummary.low}</span>
            <span class="badge text-bg-secondary">None: ${demandSummary.none}</span>
          </div>
        </div>

        <div class="panel mb-3">
          <div class="card-body p-3">
            <div class="row g-2 align-items-end">
              <div class="col-md-4">
                <label class="form-label small text-muted">Filter by City</label>
                <select class="form-select form-select-sm" id="routeCityFilter">
                  <option value="">All Cities</option>
                  ${routeCityOptions}
                </select>
              </div>
              <div class="col-md-2">
                <button type="button" class="btn btn-sm btn-outline-secondary w-100" id="routeFilterReset">Reset</button>
              </div>
            </div>
          </div>
        </div>

        <div class="panel mb-4">
          <div class="card-body p-3">
            <form class="row g-2 align-items-end" method="POST" action="/admin/routes">
              <div class="col-md-3">
                <label class="form-label small text-muted">Start Point</label>
                <input type="text" class="form-control form-control-sm" name="startPoint" required>
              </div>
              <div class="col-md-3">
                <label class="form-label small text-muted">Destination</label>
                <input type="text" class="form-control form-control-sm" name="endPoint" required>
              </div>
              <div class="col-md-2">
                <label class="form-label small text-muted">Distance (km)</label>
                <input type="number" class="form-control form-control-sm" name="distanceKm" min="1" max="30" step="0.1" required>
              </div>
              <div class="col-md-2">
                <label class="form-label small text-muted">Fare (Rs)</label>
                <input type="number" class="form-control form-control-sm" name="fare" min="0" step="1" required>
              </div>
              <div class="col-md-1">
                <label class="form-label small text-muted">Active</label>
                <div class="form-check">
                  <input class="form-check-input" type="checkbox" name="isActive" checked>
                </div>
              </div>
              <div class="col-md-1">
                <button type="submit" class="btn btn-sm btn-success w-100">Add</button>
              </div>
            </form>
          </div>
        </div>

        <div class="panel">
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead class="table-light">
                <tr>
                  <th>Route ID</th>
                  <th>Start</th>
                  <th>Destination</th>
                  <th>Distance (km)</th>
                  <th>Fare (Rs)</th>
                  <th>Demand</th>
                  <th>Demand Level</th>
                  <th class="text-center">Active</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="routeTableBody">${routeRows || '<tr><td colspan="9" class="text-center py-4">No routes found</td></tr>'}</tbody>
            </table>
          </div>
        </div>
        </section>

        <section id="institutions-section" class="section-panel d-none">
        <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
          <h5 class="mb-0"><i class="bi bi-buildings me-2"></i>Institutions</h5>
          <span class="badge text-bg-light">${Object.keys(institutionMap).length} Institutions</span>
        </div>
        <div class="panel">
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead class="table-light">
                <tr>
                  <th>Institution</th>
                  <th>Type</th>
                  <th>District</th>
                  <th>Total</th>
                  <th>Approved</th>
                  <th>Pending</th>
                  <th>Rejected</th>
                </tr>
              </thead>
              <tbody>${institutionRows || '<tr><td colspan="7" class="text-center py-4">No institutions found</td></tr>'}</tbody>
            </table>
          </div>
        </div>
        </section>

        <section id="id-generation-section" class="section-panel d-none">
        <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
          <h5 class="mb-0"><i class="bi bi-person-vcard me-2"></i>ID Generation</h5>
          <span class="badge text-bg-success">${approvedApps.length} Approved</span>
        </div>
        <div class="panel">
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead class="table-light">
                <tr>
                  <th>Application No</th>
                  <th>Student</th>
                  <th>Institution</th>
                  <th>Type</th>
                  <th>Submitted</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>${idGenRows || '<tr><td colspan="6" class="text-center py-4">No approved applications found</td></tr>'}</tbody>
            </table>
          </div>
        </div>
        </section>

        <section id="users-section" class="section-panel d-none">
        <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
          <h5 class="mb-0"><i class="bi bi-people me-2"></i>Users</h5>
        </div>
        <div class="row g-3">
          <div class="col-lg-4">
            <div class="panel p-3 h-100">
              <h6 class="mb-2"><i class="bi bi-person-badge me-2"></i>Admins</h6>
              <div class="table-responsive">
                <table class="table table-sm align-middle mb-0">
                  <thead class="table-light">
                    <tr><th>Username</th><th>Role</th><th>Status</th></tr>
                  </thead>
                  <tbody>${adminRows || '<tr><td colspan="3" class="text-center py-3">No admins found</td></tr>'}</tbody>
                </table>
              </div>
            </div>
          </div>
          <div class="col-lg-4">
            <div class="panel p-3 h-100">
              <h6 class="mb-2"><i class="bi bi-mortarboard me-2"></i>Students</h6>
              <div class="table-responsive">
                <table class="table table-sm align-middle mb-0">
                  <thead class="table-light">
                    <tr><th>Name</th><th>Email</th><th>Role</th></tr>
                  </thead>
                  <tbody>${studentRows || '<tr><td colspan="3" class="text-center py-3">No students found</td></tr>'}</tbody>
                </table>
              </div>
            </div>
          </div>
          <div class="col-lg-4">
            <div class="panel p-3 h-100">
              <h6 class="mb-2"><i class="bi bi-building me-2"></i>School Authorities</h6>
              <div class="table-responsive">
                <table class="table table-sm align-middle mb-0">
                  <thead class="table-light">
                    <tr><th>Email</th><th>School</th><th>Status</th></tr>
                  </thead>
                  <tbody>${schoolUserRows || '<tr><td colspan="3" class="text-center py-3">No school authorities found</td></tr>'}</tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
        </section>

        <section id="settings-section" class="section-panel d-none">
        <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
          <h5 class="mb-0"><i class="bi bi-gear me-2"></i>Settings</h5>
        </div>
        <div class="panel p-3">
          <div class="row g-3">
            <div class="col-md-4">
              <label class="form-label">Max Distance (km)</label>
              <input type="number" class="form-control" value="30" disabled>
            </div>
            <div class="col-md-4">
              <label class="form-label">Minimum Fare (Rs)</label>
              <input type="number" class="form-control" value="300" disabled>
            </div>
            <div class="col-md-4">
              <label class="form-label">Maximum Fare (Rs)</label>
              <input type="number" class="form-control" value="2500" disabled>
            </div>
            <div class="col-md-6">
              <label class="form-label">Fare Rule</label>
              <input type="text" class="form-control" value="150 + distance*40 (rounded to nearest 10)" disabled>
            </div>
            <div class="col-md-6">
              <label class="form-label">Renewal Window</label>
              <input type="text" class="form-control" value="After expiry only, within academic year" disabled>
            </div>
          </div>
        </div>
        </section>
      </main>
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <script>
    (function () {
      const sectionLinks = document.querySelectorAll("[data-section-link]");
      const sections = document.querySelectorAll(".section-panel");
      if (!sectionLinks.length || !sections.length) return;

      function setActive(link) {
        sectionLinks.forEach((item) => {
          item.classList.toggle("active", item === link);
        });
      }

      function showSection(sectionId) {
        sections.forEach((section) => {
          section.classList.toggle("d-none", section.id !== sectionId);
        });
      }

      sectionLinks.forEach((link) => {
        link.addEventListener("click", (event) => {
          event.preventDefault();
          const target = link.getAttribute("data-section-link");
          if (!target) return;
          setActive(link);
          showSection(target);
        });
      });
    })();

    (function () {
      const layout = document.getElementById("adminLayout");
      const toggle = document.getElementById("sidebarToggle");
      const icon = document.getElementById("sidebarToggleIcon");
      if (!layout || !toggle || !icon) return;

      function syncIcon() {
        const isCollapsed = layout.classList.contains("sidebar-collapsed");
        icon.className = isCollapsed ? "bi bi-chevron-right" : "bi bi-chevron-left";
      }

      toggle.addEventListener("click", function () {
        layout.classList.toggle("sidebar-collapsed");
        syncIcon();
      });

      syncIcon();
    })();

    (function () {
      const filter = document.getElementById("routeCityFilter");
      const reset = document.getElementById("routeFilterReset");
      const tbody = document.getElementById("routeTableBody");
      if (!filter || !tbody) return;

      function normalize(value) {
        return String(value || "")
          .toLowerCase()
          .trim()
          .replace(/\s+/g, " ");
      }

      function applyFilter() {
        const value = normalize(filter.value);
        const rows = Array.from(tbody.querySelectorAll("tr"));
        let visible = 0;
        rows.forEach((row) => {
          const start = normalize(row.getAttribute("data-start"));
          const end = normalize(row.getAttribute("data-end"));
          const show = !value || start === value || end === value || start.includes(value) || end.includes(value);
          row.classList.toggle("d-none", !show);
          if (show) visible += 1;
        });
        const empty = tbody.querySelector(".no-rows");
        if (!visible) {
          if (!empty) {
            const tr = document.createElement("tr");
            tr.className = "no-rows";
            tr.innerHTML = '<td colspan="9" class="text-center py-4">No routes found</td>';
            tbody.appendChild(tr);
          }
        } else if (empty) {
          empty.remove();
        }
      }

      filter.addEventListener("change", applyFilter);
      if (reset) {
        reset.addEventListener("click", function () {
          filter.value = "";
          applyFilter();
        });
      }
    })();

    (function () {
      const revenueData = ${districtRevenueJson};
      const select = document.getElementById("districtRevenueSelect");
      const valueEl = document.getElementById("districtRevenueValue");
      const metaEl = document.getElementById("districtRevenueMeta");
      if (!select || !valueEl || !metaEl) return;

      const inr = new Intl.NumberFormat("en-IN");
      const totals = revenueData.reduce(
        (acc, item) => {
          acc.revenue += Number(item.revenue || 0);
          acc.passes += Number(item.passes || 0);
          return acc;
        },
        { revenue: 0, passes: 0 }
      );

      function renderRevenue() {
        const district = (select.value || "").toLowerCase();
        const selected = revenueData.find((item) => item.district.toLowerCase() === district);
        const revenue = selected ? Number(selected.revenue || 0) : totals.revenue;
        const passes = selected ? Number(selected.passes || 0) : totals.passes;
        const label = selected ? selected.district : "All Districts";

        valueEl.textContent = "Rs " + inr.format(Math.round(revenue));
        metaEl.textContent = passes + " verified payments counted for " + label;
      }

      select.addEventListener("change", renderRevenue);
      renderRevenue();
    })();

    (function () {
      if (typeof Chart === "undefined") return;

      const statusData = ${statusChartJson};
      const districtData = ${districtChartJson};
      const trendData = ${trendChartJson};
      const institutionData = ${institutionChartJson};

      const statusCtx = document.getElementById("statusChart");
      if (statusCtx) {
        new Chart(statusCtx, {
          type: "pie",
          data: {
            labels: statusData.labels,
            datasets: [
              {
                data: statusData.values,
                backgroundColor: ["#22c55e", "#f59e0b", "#ef4444"]
              }
            ]
          }
        });
      }

      const districtCtx = document.getElementById("districtChart");
      if (districtCtx) {
        new Chart(districtCtx, {
          type: "bar",
          data: {
            labels: districtData.labels,
            datasets: [
              {
                label: "Applications",
                data: districtData.values,
                backgroundColor: "#3b82f6"
              }
            ]
          },
          options: {
            scales: { y: { beginAtZero: true } }
          }
        });
      }

      const trendCtx = document.getElementById("trendChart");
      if (trendCtx) {
        new Chart(trendCtx, {
          type: "line",
          data: {
            labels: trendData.labels,
            datasets: [
              {
                label: "Submissions",
                data: trendData.values,
                borderColor: "#10b981",
                backgroundColor: "rgba(16, 185, 129, 0.2)",
                tension: 0.35,
                fill: true
              }
            ]
          },
          options: {
            scales: { y: { beginAtZero: true } }
          }
        });
      }

      const institutionCtx = document.getElementById("institutionChart");
      if (institutionCtx) {
        new Chart(institutionCtx, {
          type: "doughnut",
          data: {
            labels: institutionData.labels,
            datasets: [
              {
                data: institutionData.values,
                backgroundColor: ["#2563eb", "#16a34a", "#94a3b8"]
              }
            ]
          }
        });
      }

      const revenueCtx = document.getElementById("revenueChart");
      if (revenueCtx) {
        const revenueData = ${districtRevenueJson};
        const topRevenue = revenueData
          .slice()
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 5);
        new Chart(revenueCtx, {
          type: "bar",
          data: {
            labels: topRevenue.map((d) => d.district),
            datasets: [
              {
                label: "Revenue (Rs)",
                data: topRevenue.map((d) => Math.round(d.revenue)),
                backgroundColor: "#0ea5e9"
              }
            ]
          },
          options: {
            scales: { y: { beginAtZero: true } }
          }
        });
      }
    })();
  </script>
</body>
</html>`);
});

app.post("/admin/backfill-validity", isAdmin, async (req, res) => {
  try {
    const apps = await Application.find({
      status: "Approved",
      $or: [
        { currentValidFrom: { $exists: false } },
        { currentValidTo: { $exists: false } },
        { academicYear: { $exists: false } },
        { academicYear: null },
        { academicYear: "" }
      ]
    });

    for (const appData of apps) {
      const baseDate = appData.currentValidFrom || appData.updatedAt || appData.createdAt || new Date();
      if (!appData.currentValidFrom) appData.currentValidFrom = baseDate;
      if (!appData.currentValidTo) appData.currentValidTo = getExpiryDate(baseDate);
      if (!appData.academicYear) appData.academicYear = getAcademicYear(baseDate);
      await appData.save();
    }

    res.redirect("/admin-dashboard?backfill=done");
  } catch (err) {
    console.error("Backfill error:", err);
    res.status(500).send(`Failed to backfill validity fields: ${err.message || "Unknown error"}`);
  }
});

app.post("/admin/backfill-districts", isAdmin, async (req, res) => {
  try {
    const apps = await Application.find({
      $or: [
        { district: { $exists: false } },
        { district: "" },
        { district: null }
      ]
    }).select("_id studentId personalEmail collegeEmail");

    if (!apps.length) return res.redirect("/admin-dashboard?backfill=districts");

    const studentIds = apps
      .map((a) => (a.studentId ? a.studentId.toString() : ""))
      .filter(Boolean);
    const students = studentIds.length
      ? await Student.find({ _id: { $in: studentIds } }).select("_id profile.district email profile.personalEmail profile.collegeEmail")
      : [];

    const studentDistrictMap = students.reduce((acc, s) => {
      acc[s._id.toString()] = String(s?.profile?.district || "").trim();
      return acc;
    }, {});

    const studentDistrictByEmail = students.reduce((acc, s) => {
      const district = String(s?.profile?.district || "").trim();
      const email = String(s.email || "").trim().toLowerCase();
      const personal = String(s?.profile?.personalEmail || "").trim().toLowerCase();
      const college = String(s?.profile?.collegeEmail || "").trim().toLowerCase();
      if (email) acc[email] = district;
      if (personal) acc[personal] = district;
      if (college) acc[college] = district;
      return acc;
    }, {});

    const bulk = apps.map((app) => {
      const sid = app.studentId ? app.studentId.toString() : "";
      const byId = sid ? studentDistrictMap[sid] : "";
      const personalEmail = String(app.personalEmail || "").trim().toLowerCase();
      const collegeEmail = String(app.collegeEmail || "").trim().toLowerCase();
      const byEmail = studentDistrictByEmail[personalEmail] || studentDistrictByEmail[collegeEmail] || "";
      const district = (byId || byEmail || "").trim();
      return {
        updateOne: {
          filter: { _id: app._id },
          update: { $set: { district } }
        }
      };
    });

    await Application.bulkWrite(bulk);
    res.redirect("/admin-dashboard?backfill=districts");
  } catch (err) {
    console.error("Backfill districts error:", err);
    res.status(500).send(`Failed to backfill districts: ${err.message || "Unknown error"}`);
  }
});

app.post("/admin/backfill-route-fares", isAdmin, async (req, res) => {
  try {
    const routes = await Route.find({ isActive: true }).select("startPoint endPoint distanceKm fare");
    const routeMap = routes.reduce((acc, r) => {
      const start = String(r.startPoint || "").trim().toLowerCase();
      const end = String(r.endPoint || "").trim().toLowerCase();
      const dist = Number(r.distanceKm || 0);
      if (!start || !end || !Number.isFinite(dist)) return acc;
      acc[`${start}||${end}||${dist}`] = Number(r.fare || 0);
      return acc;
    }, {});

    const apps = await Application.find({
      $or: [
        { ticketAmount: { $exists: false } },
        { ticketAmount: 0 },
        { ticketAmount: null }
      ]
    }).select("_id startRoute endRoute distanceKm");

    if (!apps.length) return res.redirect("/admin-dashboard?backfill=fares");

    const bulk = apps.map((app) => {
      const start = String(app.startRoute || "").trim().toLowerCase();
      const end = String(app.endRoute || "").trim().toLowerCase();
      const dist = Number(app.distanceKm || 0);
      const fare = routeMap[`${start}||${end}||${dist}`];
      if (!fare) return null;
      return {
        updateOne: {
          filter: { _id: app._id },
          update: { $set: { ticketAmount: fare } }
        }
      };
    }).filter(Boolean);

    if (bulk.length) await Application.bulkWrite(bulk);
    res.redirect("/admin-dashboard?backfill=fares");
  } catch (err) {
    console.error("Backfill route fares error:", err);
    res.status(500).send(`Failed to backfill route fares: ${err.message || "Unknown error"}`);
  }
});

app.post("/payment", async (req, res) => {
  try {
    const applicationNo = String(req.body.applicationNo || "").trim();
    const transactionId = String(req.body.transactionId || "").trim();
    if (!applicationNo || !transactionId) {
      return res.status(400).send("Application number and transaction ID are required.");
    }

    const appData = await Application.findOne({ applicationNo });
    if (!appData) return res.status(404).send("Application not found.");
    if (String(appData.institutionType || "").toLowerCase() === "school") {
      return res.status(400).send("School applications do not require payment.");
    }

    appData.transactionId = transactionId;
    appData.paymentStatus = "PendingVerification";
    appData.paymentSubmittedAt = new Date();
    await appData.save();

    res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Payment Submitted</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet" />
  <style>
    body {
      background: linear-gradient(135deg, #f3f7ff 0%, #f7fff9 100%);
      min-height: 100vh;
    }
    .gov-banner {
      background: linear-gradient(120deg, #0d5bd8, #0f8f7a);
      color: #fff;
      padding: 16px 0;
    }
    .gov-banner h1 {
      font-size: 1.1rem;
      margin: 0;
      font-weight: 700;
      letter-spacing: 0.3px;
    }
    .gov-banner .sub {
      font-size: 0.9rem;
      opacity: 0.85;
    }
    .confirm-card {
      background: #fff;
      border-radius: 18px;
      border: 1px solid #e2e8f5;
      box-shadow: 0 20px 40px rgba(17, 38, 79, 0.12);
    }
    .confirm-icon {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: #e9fbf4;
      border: 2px solid #bce8d2;
      display: grid;
      place-items: center;
      font-size: 28px;
      color: #169c61;
      margin: 0 auto 12px;
    }
    .txn-box {
      background: #f3f7ff;
      border: 1px dashed #b4c9ff;
      border-radius: 12px;
      padding: 14px 16px;
      font-weight: 700;
      color: #0d5bd8;
      letter-spacing: 0.5px;
    }
  </style>
</head>
<body>
  <header class="gov-banner">
    <div class="container text-center">
      <h1>Government of Tamil Nadu - Transport Department</h1>
      <div class="sub">Student Bus Pass Management System</div>
    </div>
  </header>

  <main class="container py-5">
    <div class="row justify-content-center">
      <div class="col-lg-7">
        <div class="confirm-card p-4 p-md-5 text-center">
          <div class="confirm-icon">OK</div>
          <h2 class="h4 mb-2">Payment Submitted Successfully</h2>
          <p class="text-muted mb-4">
            Your payment details were recorded and will be verified by the admin authority.
          </p>
          <div class="txn-box mb-4">
            Transaction ID: ${escapeHtml(transactionId)}
          </div>
          <div class="d-flex justify-content-center gap-2 flex-wrap">
            <a href="/status" class="btn btn-success">Check Status</a>
            <a href="/" class="btn btn-outline-secondary">Home</a>
          </div>
        </div>
      </div>
    </div>
  </main>
</body>
</html>`);
  } catch (err) {
    console.error("Payment submit error:", err);
    res.status(500).send("Unable to submit payment right now.");
  }
});

app.post("/renewal-payment", isStudentOrSchool, async (req, res) => {
  try {
    const applicationNo = String(req.body.applicationNo || "").trim();
    const transactionId = String(req.body.transactionId || "").trim();
    if (!applicationNo || !transactionId) {
      return res.status(400).json({ error: "Application number and transaction ID are required." });
    }

    const appData = await Application.findOne({ applicationNo });
    if (!appData) return res.status(404).json({ error: "Application not found." });

    const isCollege = String(appData.institutionType || "").toLowerCase() === "college";
    if (!isCollege) {
      return res.status(400).json({ error: "School applications do not require renewal payment." });
    }

    appData.renewalTransactionId = transactionId;
    appData.renewalPaymentStatus = "PendingVerification";
    appData.renewalPaymentSubmittedAt = new Date();
    await appData.save();

    res.json({ success: true, message: "Renewal payment submitted for verification." });
  } catch (err) {
    console.error("Renewal payment error:", err);
    res.status(500).json({ error: "Unable to submit renewal payment." });
  }
});

app.post("/admin/verify-payment/:id", isAdmin, async (req, res) => {
  try {
    const appData = await Application.findById(req.params.id);
    if (!appData) return res.status(404).send("Application not found");

    appData.paymentStatus = "Verified";
    appData.paymentVerifiedAt = new Date();
    await appData.save();

    res.redirect(`/admin/application/${appData._id}`);
  } catch (err) {
    console.error("Verify payment error:", err);
    res.status(500).send("Unable to verify payment.");
  }
});

app.post("/admin/verify-renewal-payment/:id", isAdmin, async (req, res) => {
  try {
    const appData = await Application.findById(req.params.id);
    if (!appData) return res.status(404).send("Application not found");

    appData.renewalPaymentStatus = "Verified";
    appData.renewalPaymentVerifiedAt = new Date();

    // Auto-trigger renewal for college students
    const now = new Date();
    const newValidFrom = now;
    const newValidTo = getExpiryDate(newValidFrom);

    appData.renewals = appData.renewals || [];
    appData.renewals.push({
      renewedAt: now,
      validFrom: newValidFrom,
      validTo: newValidTo,
      distanceKm: appData.distanceKm || 0
    });
    appData.currentValidFrom = newValidFrom;
    appData.currentValidTo = newValidTo;
    appData.renewalPaymentStatus = "Not Paid";
    appData.renewalTransactionId = null;
    appData.renewalPaymentSubmittedAt = null;
    appData.renewalPaymentVerifiedAt = null;

    await appData.save();
    res.redirect(`/admin/application/${appData._id}`);
  } catch (err) {
    console.error("Verify renewal payment error:", err);
    res.status(500).send("Unable to verify renewal payment.");
  }
});

app.get("/admin/application/:id", isAdmin, async (req, res) => {
  const appData = await Application.findById(req.params.id);
  if (!appData) return res.status(404).send("Application not found");

  const rejectionOptions = rejectionReasons
    .map((reason) => `<option value="${escapeHtml(reason)}">${escapeHtml(reason)}</option>`)
    .join("");

  const isPending = appData.status === "Pending";
  const paymentStatus = escapeHtml(appData.paymentStatus || "Not Paid");
  const renewalPaymentStatus = escapeHtml(appData.renewalPaymentStatus || "Not Paid");
  const paymentBlock = `
      <div class="action-card mt-3">
        <div class="section-title mb-3"><i class="bi bi-credit-card me-1"></i>Payment Verification</div>
        <div class="row g-3">
          <div class="col-md-4">
            <div class="meta-item">
              <div class="meta-label">Payment Status</div>
              <div class="meta-value">${paymentStatus}</div>
            </div>
          </div>
          <div class="col-md-4">
            <div class="meta-item">
              <div class="meta-label">Transaction ID</div>
              <div class="meta-value">${escapeHtml(appData.transactionId || "-")}</div>
            </div>
          </div>
          <div class="col-md-4">
            <div class="meta-item">
              <div class="meta-label">Submitted On</div>
              <div class="meta-value">${
                appData.paymentSubmittedAt ? new Date(appData.paymentSubmittedAt).toLocaleDateString("en-IN") : "-"
              }</div>
            </div>
          </div>
        </div>
        ${
          appData.paymentStatus !== "Verified" && appData.transactionId
            ? `
              <form method="POST" action="/admin/verify-payment/${appData._id}" class="mt-3">
                <button class="btn btn-outline-success" type="submit"><i class="bi bi-check2-circle me-1"></i>Verify Payment</button>
              </form>
            `
            : ""
        }
      </div>
    `;

  const renewalPaymentBlock = `
      <div class="action-card mt-3">
        <div class="section-title mb-3"><i class="bi bi-cash-coin me-1"></i>Renewal Payment</div>
        <div class="row g-3">
          <div class="col-md-4">
            <div class="meta-item">
              <div class="meta-label">Renewal Status</div>
              <div class="meta-value">${renewalPaymentStatus}</div>
            </div>
          </div>
          <div class="col-md-4">
            <div class="meta-item">
              <div class="meta-label">Transaction ID</div>
              <div class="meta-value">${escapeHtml(appData.renewalTransactionId || "-")}</div>
            </div>
          </div>
          <div class="col-md-4">
            <div class="meta-item">
              <div class="meta-label">Submitted On</div>
              <div class="meta-value">${
                appData.renewalPaymentSubmittedAt ? new Date(appData.renewalPaymentSubmittedAt).toLocaleDateString("en-IN") : "-"
              }</div>
            </div>
          </div>
        </div>
        ${
          appData.renewalPaymentStatus !== "Verified" && appData.renewalTransactionId
            ? `
              <form method="POST" action="/admin/verify-renewal-payment/${appData._id}" class="mt-3">
                <button class="btn btn-outline-success" type="submit"><i class="bi bi-check2-circle me-1"></i>Verify Renewal Payment</button>
              </form>
            `
            : ""
        }
      </div>
    `;

  res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Application Review</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet" />
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet" />
  <style>
    body {
      background:
        radial-gradient(circle at 14% 18%, #d9ecff 0%, transparent 36%),
        radial-gradient(circle at 86% 82%, #dff9ea 0%, transparent 34%),
        linear-gradient(135deg, #f6faff 0%, #f8fffb 100%);
    }
    .page-head {
      background: linear-gradient(135deg, #0f5132 0%, #198754 100%);
      color: #fff;
      border-radius: 14px;
      padding: 1rem 1.2rem;
      box-shadow: 0 8px 22px rgba(16, 94, 57, 0.25);
    }
    .review-card {
      border: 1px solid #dbe8f7;
      border-radius: 14px;
      box-shadow: 0 16px 42px rgba(20, 56, 98, 0.12);
    }
    .section-title {
      font-size: 0.9rem;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      font-weight: 700;
      color: #0b5ed7;
      margin-bottom: 0.75rem;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.8rem;
    }
    .meta-item {
      border: 1px solid #deebfa;
      border-radius: 10px;
      background: #fff;
      padding: 0.75rem 0.85rem;
    }
    .meta-label {
      font-size: 0.75rem;
      color: #53708f;
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: 0.35px;
    }
    .meta-value {
      font-size: 0.95rem;
      font-weight: 700;
      color: #20354b;
      margin-top: 0.2rem;
    }
    .doc-card {
      border: 1px solid #dce7f4;
      border-radius: 10px;
      padding: 0.8rem;
      background: #fff;
    }
    .action-card {
      border: 1px solid #dce7f4;
      border-radius: 12px;
      background: #f8fbff;
      padding: 1rem;
    }
    @media (max-width: 768px) {
      .meta-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="container py-4">
    <div class="page-head d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
      <div>
        <div class="small opacity-75">Admin Panel</div>
        <h1 class="h5 mb-0"><i class="bi bi-file-earmark-medical-fill me-2"></i>Application Review</h1>
      </div>
      <a href="/admin-dashboard" class="btn btn-light btn-sm"><i class="bi bi-arrow-left me-1"></i>Back to Dashboard</a>
    </div>

    <div class="card review-card border-0">
      <div class="card-body p-3 p-md-4">
        <div class="row g-4">
          <div class="col-lg-8">
            <div class="section-title"><i class="bi bi-person-vcard-fill me-1"></i>Application Snapshot</div>
            <div class="meta-grid">
              <div class="meta-item"><div class="meta-label">Application No</div><div class="meta-value">${escapeHtml(appData.applicationNo)}</div></div>
              <div class="meta-item"><div class="meta-label">Bus Pass ID</div><div class="meta-value">${escapeHtml(appData.idNumber)}</div></div>
              <div class="meta-item"><div class="meta-label">Ticket Number</div><div class="meta-value">${escapeHtml(appData.ticketNumber || "-")}</div></div>
              <div class="meta-item"><div class="meta-label">Student Name</div><div class="meta-value">${escapeHtml(appData.studentName)}</div></div>
              <div class="meta-item"><div class="meta-label">Institution</div><div class="meta-value">${escapeHtml(appData.collegeName || appData.schoolName || "-")}</div></div>
              <div class="meta-item"><div class="meta-label">Route</div><div class="meta-value">${escapeHtml(appData.startRoute)} to ${escapeHtml(appData.endRoute)} (${escapeHtml(appData.distanceKm || 0)} km)</div></div>
              <div class="meta-item"><div class="meta-label">Status</div><div class="meta-value"><span class="badge ${badgeClass(appData.status)}">${escapeHtml(appData.status)}</span></div></div>
              <div class="meta-item"><div class="meta-label">Submitted</div><div class="meta-value">${new Date(appData.createdAt).toLocaleDateString("en-IN")}</div></div>
              <div class="meta-item"><div class="meta-label">Academic Year</div><div class="meta-value">${escapeHtml(appData.academicYear || "-")}</div></div>
              <div class="meta-item"><div class="meta-label">Current Validity</div><div class="meta-value">${
                appData.currentValidFrom && appData.currentValidTo
                  ? `${new Date(appData.currentValidFrom).toLocaleDateString("en-IN")} to ${new Date(appData.currentValidTo).toLocaleDateString("en-IN")}`
                  : "-"
              }</div></div>
              <div class="meta-item"><div class="meta-label">Renewals</div><div class="meta-value">${escapeHtml(String((appData.renewals || []).length))}</div></div>
            </div>
            ${
              appData.status === "Rejected"
                ? `<div class="alert alert-danger mt-3 mb-0"><strong><i class="bi bi-exclamation-triangle-fill me-1"></i>Rejection Reason:</strong> ${escapeHtml(appData.rejectionReason || "Not provided")}</div>`
                : ""
            }
            <div class="section-title mt-4"><i class="bi bi-arrow-repeat me-1"></i>Renewal History</div>
            ${
              (appData.renewals || []).length
                ? `
                  <div class="table-responsive">
                    <table class="table table-sm align-middle">
                      <thead>
                        <tr>
                          <th>Renewed At</th>
                          <th>Validity</th>
                          <th>Distance</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${(appData.renewals || [])
                          .map(
                            (r) => `
                              <tr>
                                <td>${r.renewedAt ? new Date(r.renewedAt).toLocaleDateString("en-IN") : "-"}</td>
                                <td>${
                                  r.validFrom && r.validTo
                                    ? `${new Date(r.validFrom).toLocaleDateString("en-IN")} to ${new Date(r.validTo).toLocaleDateString("en-IN")}`
                                    : "-"
                                }</td>
                                <td>${escapeHtml(String(r.distanceKm || 0))} km</td>
                              </tr>
                            `
                          )
                          .join("")}
                      </tbody>
                    </table>
                  </div>
                `
                : `<div class="text-muted">No renewals yet.</div>`
            }
          </div>

          <div class="col-lg-4">
            <div class="section-title"><i class="bi bi-folder2-open me-1"></i>Uploaded Documents</div>
            <div class="doc-card">
              <div class="d-grid gap-2">
                <a class="btn btn-outline-primary btn-sm" href="/${escapeHtml(appData.studentPhoto)}" target="_blank"><i class="bi bi-image me-1"></i>Student Photo</a>
                <a class="btn btn-outline-primary btn-sm" href="/${escapeHtml(appData.aadhaarFile)}" target="_blank"><i class="bi bi-file-earmark-text me-1"></i>Aadhaar</a>
                <a class="btn btn-outline-primary btn-sm" href="/${escapeHtml(appData.idProof)}" target="_blank"><i class="bi bi-person-badge me-1"></i>College/School ID</a>
                <a class="btn btn-outline-primary btn-sm" href="/${escapeHtml(appData.bonafide)}" target="_blank"><i class="bi bi-patch-check me-1"></i>Bonafide</a>
              </div>
            </div>
          </div>
        </div>

        <hr class="my-4" />

        <div class="action-card">
          <div class="section-title mb-3"><i class="bi bi-clipboard2-check-fill me-1"></i>Review Actions</div>
          ${
            isPending
              ? `
                <div class="row g-3">
                  <div class="col-md-6">
                    <a href="/approve/${appData._id}" class="btn btn-success w-100"><i class="bi bi-check2-circle me-1"></i>Approve Application</a>
                  </div>
                  <div class="col-md-6">
                    <form method="POST" action="/reject/${appData._id}">
                      <select class="form-select mb-2" name="reason" required>
                        <option value="" selected disabled>Select rejection reason</option>
                        ${rejectionOptions}
                      </select>
                      <button class="btn btn-danger w-100" type="submit"><i class="bi bi-x-circle me-1"></i>Reject Application</button>
                    </form>
                  </div>
                </div>
              `
              : `
                <div class="alert ${appData.status === "Approved" ? "alert-success" : "alert-danger"} mb-0">
                  This application is already ${escapeHtml(appData.status)}.
                </div>
              `
          }
        </div>

        ${
          appData.status === "Approved"
            ? `
              <div class="d-flex gap-2 flex-wrap mt-3">
                <a href="/bus-pass-id/${encodeURIComponent(appData.applicationNo)}" class="btn btn-success" target="_blank"><i class="bi bi-person-vcard me-1"></i>View ID</a>
                <a href="/bus-ticket/${encodeURIComponent(appData.applicationNo)}" class="btn btn-info text-white" target="_blank"><i class="bi bi-ticket-perforated me-1"></i>View Ticket</a>
              </div>
            `
            : ""
        }
      </div>

      ${paymentBlock}
      ${String(appData.institutionType || "").toLowerCase() === "college" ? renewalPaymentBlock : ""}
    </div>
  </main>
</body>
</html>`);
});

app.get("/approve/:id", isAdmin, async (req, res) => {
  const appData = await Application.findById(req.params.id);
  if (!appData) return res.status(404).send("Application not found");
  const isSchoolApp = String(appData.institutionType || "").toLowerCase() === "school";
  if (!isSchoolApp && appData.paymentStatus !== "Verified") {
    return res
      .status(400)
      .send(`Payment not verified. Verify the transaction before approval. <a href="/admin/application/${appData._id}">Back to Application</a>`);
  }

  const now = new Date();
  appData.status = "Approved";
  appData.rejectionReason = null;
  appData.currentValidFrom = now;
  appData.currentValidTo = getExpiryDate(now);

  // Set ID dates only once; renewals must not change these dates.
  if (!appData.idIssuedAt) {
    appData.idIssuedAt = now;
  }
  if (!appData.idExpiryAt) {
    appData.idExpiryAt = getAcademicYearEnd(appData.idIssuedAt);
  }

  await appData.save();

  res.redirect("/admin-dashboard");
});

app.post("/reject/:id", isAdmin, async (req, res) => {
  const appData = await Application.findByIdAndUpdate(
    req.params.id,
    {
      status: "Rejected",
      rejectionReason: req.body.reason
    },
    { new: true }
  );
  res.redirect("/admin-dashboard");
});

app.post("/renew/:applicationNo", isStudentOrSchool, async (req, res) => {
  try {
    const isSchoolUser = Boolean(req.session.school);
    const appData = await Application.findOne({ applicationNo: req.params.applicationNo });
    if (!appData) return res.status(404).json({ error: "Application not found" });

    if (isSchoolUser) {
      const isSchoolOwner = appData.appliedById && appData.appliedById.toString() === req.session.school;
      if (!isSchoolOwner) return res.status(403).json({ error: "Not authorized to renew this pass" });
    } else {
      const student = await Student.findById(req.session.student).select("email");
      if (!student) return res.status(404).json({ error: "Student account not found" });

      const isOwner =
        (appData.studentId && appData.studentId.toString() === req.session.student) ||
        appData.personalEmail === student.email ||
        appData.collegeEmail === student.email;

      if (!isOwner) return res.status(403).json({ error: "Not authorized to renew this pass" });
    }

    if (appData.status !== "Approved") {
      return res.status(400).json({ error: "Only approved passes can be renewed" });
    }

    const now = new Date();
    const activeAcademicYear = getAcademicYear(now);
    if (!appData.academicYear || appData.academicYear !== activeAcademicYear) {
      return res.status(400).json({ error: "Academic year ended. Submit a fresh application." });
    }

    if (!appData.currentValidTo || now < new Date(appData.currentValidTo)) {
      return res.status(400).json({ error: "Renewal allowed only after current pass expires" });
    }

    const isCollege = String(appData.institutionType || "").toLowerCase() === "college";
    if (isCollege && appData.renewalPaymentStatus !== "Verified") {
      return res.status(400).json({ error: "Renewal payment not verified yet." });
    }

    const newValidFrom = now;
    const newValidTo = getExpiryDate(newValidFrom);

    appData.renewals = appData.renewals || [];
    appData.renewals.push({
      renewedAt: now,
      validFrom: newValidFrom,
      validTo: newValidTo,
      distanceKm: appData.distanceKm || 0
    });
    appData.currentValidFrom = newValidFrom;
    appData.currentValidTo = newValidTo;
    if (isCollege) {
      appData.renewalPaymentStatus = "Not Paid";
      appData.renewalTransactionId = null;
      appData.renewalPaymentSubmittedAt = null;
      appData.renewalPaymentVerifiedAt = null;
    }

    await appData.save();

    res.json({
      success: true,
      currentValidFrom: appData.currentValidFrom,
      currentValidTo: appData.currentValidTo,
      renewalCount: appData.renewals.length
    });
  } catch (err) {
    console.error("Renewal error:", err);
    res.status(500).json({ error: "Unable to renew bus pass" });
  }
});

app.get("/bus-pass-data/:applicationNo", async (req, res) => {
  try {
    const appData = await Application.findOne({ applicationNo: req.params.applicationNo });
    if (!appData) return res.status(404).json({ error: "Application not found" });
    if (appData.status !== "Approved") return res.status(403).json({ error: "Ticket available only for approved applications" });

    const issueDate = new Date(appData.currentValidFrom || appData.updatedAt || appData.createdAt || Date.now());
    const expiryDate = new Date(appData.currentValidTo || getExpiryDate(issueDate));

    res.json({
      applicationNo: appData.applicationNo,
      idNumber: appData.idNumber,
      ticketNumber: appData.ticketNumber,
      studentName: appData.studentName,
      fatherName: appData.fatherName,
      dob: appData.dob,
      age: appData.age,
      gender: appData.gender,
      studentContact: appData.studentContact,
      institutionType: appData.institutionType,
      collegeName: appData.collegeName,
      department: appData.department,
      year: appData.year,
      schoolName: appData.schoolName,
      standard: appData.standard,
      startRoute: appData.startRoute,
      endRoute: appData.endRoute,
      distanceKm: appData.distanceKm,
      studentPhoto: appData.studentPhoto,
      status: appData.status,
      ticketAmount: appData.ticketAmount || computeMonthlyFare(appData.distanceKm),
      issueDate,
      expiryDate,
      createdAt: appData.createdAt,
      updatedAt: appData.updatedAt,
      currentValidFrom: appData.currentValidFrom,
      currentValidTo: appData.currentValidTo
    });
  } catch (err) {
    console.error("Bus pass data error:", err);
    res.status(500).json({ error: "Unable to fetch ticket data" });
  }
});

app.get("/bus-pass-id.html", (req, res) => {
  const appNo = (req.query.appNo || "").trim();
  if (!appNo) return res.redirect("/status");
  res.redirect(`/bus-pass-id/${encodeURIComponent(appNo)}`);
});

app.get("/bus-ticket.html", (req, res) => {
  const appNo = (req.query.appNo || "").trim();
  if (!appNo) return res.redirect("/status");
  res.redirect(`/bus-ticket/${encodeURIComponent(appNo)}`);
});

app.get("/bus-pass-id/:applicationNo", async (req, res) => {
  try {
    const appData = await Application.findOne({ applicationNo: req.params.applicationNo });
    if (!appData) return res.status(404).send("Application not found");
    if (appData.status !== "Approved") return res.status(403).send("ID card available only for approved applications");

    const { issueBase, expiryBase } = getIdCardDates(appData);
    const institutionName = appData.institutionType === "College" ? appData.collegeName : appData.schoolName;

    res.render("bus-pass-id", {
      appData,
      institutionName: institutionName || "-",
      issueDate: issueBase.toLocaleDateString("en-IN"),
      expiryDate: expiryBase.toLocaleDateString("en-IN")
    });
  } catch (err) {
    console.error("Bus pass ID render error:", err);
    res.status(500).send("Unable to load bus pass ID");
  }
});

app.get("/bus-ticket/:applicationNo", async (req, res) => {
  try {
    const appData = await Application.findOne({ applicationNo: req.params.applicationNo });
    if (!appData) return res.status(404).send("Application not found");
    if (appData.status !== "Approved") return res.status(403).send("Ticket available only for approved applications");

    const issueDate = new Date(appData.currentValidFrom || appData.updatedAt || appData.createdAt || Date.now());
    const expiryDate = new Date(appData.currentValidTo || getExpiryDate(issueDate));
    const institutionName = appData.institutionType === "College" ? appData.collegeName : appData.schoolName;

    const dayCursor = new Date(issueDate);
    dayCursor.setHours(0, 0, 0, 0);
    const dayEnd = new Date(expiryDate);
    dayEnd.setHours(0, 0, 0, 0);
    const days = [];
    while (dayCursor <= dayEnd) {
      days.push({
        label: dayCursor.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
        iso: dayCursor.toISOString().slice(0, 10)
      });
      dayCursor.setDate(dayCursor.getDate() + 1);
    }

    res.render("bus-ticket", {
      appData,
      institutionName: institutionName || "-",
      issueDate: issueDate.toLocaleDateString("en-IN"),
      expiryDate: expiryDate.toLocaleDateString("en-IN"),
      ticketAmount: appData.ticketAmount || computeMonthlyFare(appData.distanceKm),
      days
    });
  } catch (err) {
    console.error("Bus ticket render error:", err);
    res.status(500).send("Unable to load bus ticket");
  }
});

app.get("/ticket/download/:applicationNo", async (req, res) => {
  try {
    const appData = await Application.findOne({ applicationNo: req.params.applicationNo });
    if (!appData) return res.status(404).send("Application not found");
    if (appData.status !== "Approved") return res.status(403).send("Ticket download is available only after approval");

    const doc = new PDFDocument({ size: "A6", margin: 0 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=bus-pass-${appData.applicationNo}.pdf`);
    doc.pipe(res);
    buildTicketPdf(doc, appData);
    doc.end();
  } catch (err) {
    console.error("Ticket PDF error:", err);
    res.status(500).send("Failed to generate ticket PDF");
  }
});

app.get("/id/download/:applicationNo", async (req, res) => {
  try {
    const appData = await Application.findOne({ applicationNo: req.params.applicationNo });
    if (!appData) return res.status(404).send("Application not found");
    if (appData.status !== "Approved") return res.status(403).send("ID download is available only after approval");

    const doc = new PDFDocument({ size: "A6", margin: 0 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=bus-pass-id-${appData.applicationNo}.pdf`);
    doc.pipe(res);
    buildIdCardPdf(doc, appData);
    doc.end();
  } catch (err) {
    console.error("ID PDF error:", err);
    res.status(500).send("Failed to generate ID PDF");
  }
});

app.get("/id-card/:id", isAdmin, async (req, res) => {
  const appData = await Application.findById(req.params.id);
  if (!appData) return res.status(404).send("Application not found");
  if (appData.status !== "Approved") return res.status(403).send("ID card available only for approved applications");
  res.redirect(`/id/download/${encodeURIComponent(appData.applicationNo)}`);
});

app.get("/logout", (req, res) => req.session.destroy(() => res.redirect("/admin-login")));

app.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});


