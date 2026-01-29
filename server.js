const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const session = require("express-session");
const fs = require("fs");
const path = require("path");

const Application = require("./models/Application");
const Admin = require("./models/Admin");

const app = express();
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


/* ================= CREATE UPLOAD FOLDERS ================= */
["uploads", "uploads/photos", "uploads/aadhaar", "uploads/idproof"].forEach(f => {
  if (!fs.existsSync(f)) fs.mkdirSync(f, { recursive: true });
});

/* ================= MIDDLEWARE ================= */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/uploads", express.static("uploads"));

app.use(session({
  secret: "buspass_secret",
  resave: false,
  saveUninitialized: false
}));

/* ================= DATABASE ================= */
mongoose.connect("mongodb://127.0.0.1:27017/buspassDB")
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

/* ================= MULTER ================= */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === "studentPhoto") cb(null, "uploads/photos");
    if (file.fieldname === "aadhaarFile") cb(null, "uploads/aadhaar");
    if (file.fieldname === "idProof") cb(null, "uploads/idproof");
  },
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});
const upload = multer({ storage });

/* ================= HOME ================= */
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Bus Pass System</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
</head>

<body class="bg-light">

<nav class="navbar navbar-dark bg-primary">
  <div class="container">
    <span class="navbar-brand fw-bold">🚌 Bus Pass Management System</span>
  </div>
</nav>

<div class="container mt-5">
  <div class="row g-4 justify-content-center">

    <div class="col-md-4">
      <div class="card shadow text-center p-4">
        <h4>📝 Apply Bus Pass</h4>
        <p class="text-muted">Government of Tamil Nadu – Student Transport Services</p>
        </p>Submit a new bus pass application</p>
        <a href="/apply" class="btn btn-primary w-100">Apply Now</a>
      </div>
    </div>

    <div class="col-md-4">
      <div class="card shadow text-center p-4">
        <h4>🔍 Check Status</h4>
        <p class="text-muted">Track your application status</p>
        <a href="/status" class="btn btn-success w-100">Check Status</a>
      </div>
    </div>

    <div class="col-md-4">
      <div class="card shadow text-center p-4">
        <h4>🛠 Admin Panel</h4>
        <p class="text-muted">Admin login and approvals</p>
        <a href="/admin" class="btn btn-dark w-100">Admin Login</a>
      </div>
    </div>

  </div>
</div>

</body>
</html>
`);
});


/* ================= APPLICATION FORM ================= */
app.get("/apply", (req, res) => {
  res.sendFile(path.join(__dirname, "public/apply.html"));
});

/* ================= APPLY POST ================= */
app.post("/apply",
  upload.fields([
    { name: "studentPhoto", maxCount: 1 },
    { name: "aadhaarFile", maxCount: 1 },
    { name: "idProof", maxCount: 1 }
  ]),
  async (req, res) => {

    await Application.create({
      ...req.body,
      studentPhoto: req.files.studentPhoto[0].path,
      aadhaarFile: req.files.aadhaarFile[0].path,
      idProof: req.files.idProof[0].path
    });

    res.send(`<h3>Application Submitted</h3>
              <p>Application No: <b>${req.body.applicationNo}</b></p>
              <a href="/status">Check Status</a>`);
});

/* ================= STATUS PAGE ================= */
app.get("/status", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Check Status</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
</head>

<body class="bg-light">

<nav class="navbar navbar-dark bg-success px-4">
  <span class="navbar-brand">🔍 Check Application Status</span>
  <a href="/" class="btn btn-light btn-sm">Home</a>
</nav>

<div class="container mt-5">
  <div class="row justify-content-center">
    <div class="col-md-5">
      <div class="card shadow p-4">
        <h5 class="text-center mb-3">Enter Application Number</h5>

        <form method="POST" action="/check-status">
          <input
            type="text"
            name="applicationNo"
            class="form-control mb-3"
            placeholder="Application Number"
            required
          />
          <button class="btn btn-success w-100">Check Status</button>
        </form>

      </div>
    </div>
  </div>
</div>

</body>
</html>
`);
});


/* ================= STATUS CHECK ================= */
app.post("/check-status", async (req, res) => {
  const { applicationNo } = req.body;

  const appData = await Application.findOne({ applicationNo });

  if (!appData) {
    return res.send(`
      <h3 style="color:red;text-align:center;">❌ Application Not Found</h3>
      <div style="text-align:center;">
        <a href="/status">Try Again</a>
      </div>
    `);
  }

  const color =
    appData.status === "Approved" ? "success" :
    appData.status === "Rejected" ? "danger" : "warning";

  res.send(`
<!DOCTYPE html>
<html>
<head>
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
</head>

<body class="bg-light">

<nav class="navbar navbar-dark bg-primary px-4">
  <span class="navbar-brand">📄 Application Status</span>
  <a href="/" class="btn btn-light btn-sm">Home</a>
</nav>

<div class="container mt-5">
  <div class="row justify-content-center">
    <div class="col-md-6">
      <div class="card shadow text-center p-4">

        <h4 class="mb-3">Status</h4>
        <span class="badge bg-${color} fs-5">${appData.status}</span>

        <hr>

        <p><b>Application No:</b> ${appData.applicationNo}</p>
        <p><b>Name:</b> ${appData.studentName}</p>

        ${
          appData.status === "Rejected"
            ? `<div class="alert alert-danger mt-3">
                 <b>Reason for Rejection:</b><br>
                 ${appData.rejectionReason || "Not specified"}
               </div>`
            : ""
        }

        ${
          appData.status === "Approved"
            ? `<div class="alert alert-success mt-3">
                 🎉 Your application is approved.
               </div>`
            : ""
        }

        ${
          appData.status === "Pending"
            ? `<div class="alert alert-warning mt-3">
                 ⏳ Your application is under review.
               </div>`
            : ""
        }

        <a href="/status" class="btn btn-secondary mt-3">
          Check Another Application
        </a>

      </div>
    </div>
  </div>
</div>

</body>
</html>
`);
});


/* ================= ADMIN LOGIN PAGE ================= */
app.get("/admin", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<title>Admin Login</title>
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
</head>

<body class="bg-light d-flex align-items-center" style="height:100vh">

<div class="container">
  <div class="row justify-content-center">
    <div class="col-md-4">
      <div class="card shadow p-4">
        <h4 class="text-center mb-4">🔐 Admin Login</h4>

        <form method="POST" action="/admin-login">
          <div class="mb-3">
            <input class="form-control" name="username" placeholder="Username" required>
          </div>
          <div class="mb-3">
            <input type="password" class="form-control" name="password" placeholder="Password" required>
          </div>
          <button class="btn btn-primary w-100">Login</button>
        </form>

      </div>
    </div>
  </div>
</div>

</body>
</html>
`);
});


/* ================= ADMIN LOGIN LOGIC ================= */
app.post("/admin-login", async (req, res) => {
  const admin = await Admin.findOne(req.body);
  if (!admin) return res.send("❌ Invalid Login");

  req.session.admin = true;
  res.redirect("/admin-dashboard");
});

/* ================= ADMIN AUTH ================= */
function isAdmin(req, res, next) {
  if (!req.session.admin) return res.redirect("/admin");
  next();
}

/* ================= ADMIN DASHBOARD ================= */
app.get("/admin-dashboard", isAdmin, async (req, res) => {
  const apps = await Application.find().sort({ createdAt: -1 });

  const reasonOptions = rejectionReasons
    .map(r => `<option value="${r}">${r}</option>`)
    .join("");

  const rows = apps.map(a => `
    <tr>
      <td>${a.applicationNo || "N/A"}</td>
      <td>${a.studentName || "N/A"}</td>

      <td>
        <span class="badge ${
          a.status === "Approved" ? "bg-success" :
          a.status === "Rejected" ? "bg-danger" :
          "bg-warning text-dark"
        }">
          ${a.status}
        </span>

        ${
          a.status === "Rejected"
            ? `<div class="text-danger small mt-1">
                <strong>Reason:</strong>
                ${a.rejectionReason || "Reason not recorded"}
              </div>`
            : ""
        }
      </td>

      <td>
      <a href="/admin/application/${a._id}" class="btn btn-primary btn-sm w-100 mb-2">
  👁 View Application
</a>

        ${
          a.status === "Pending"
            ? `
              <form action="/reject/${a._id}" method="POST" class="mb-2">
                <select name="reason" class="form-select mb-2" required>
                  <option value="" disabled selected>
                    -- Select Rejection Reason --
                  </option>
                  ${reasonOptions}
                </select>

                <button class="btn btn-danger btn-sm w-100">
                  Reject
                </button>
              </form>

              <a href="/approve/${a._id}" class="btn btn-success btn-sm w-100">
                Approve
              </a>
            `
            : a.status === "Approved"
            ? `
              <a href="/id-card/${a._id}" class="btn btn-primary btn-sm w-100">
                🎫 Generate ID Card
              </a>
            `
            : `<span class="text-muted">No action available</span>`
        }
      </td>
    </tr>
  `).join("");

  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Admin Dashboard</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
</head>

<body class="bg-light">

<nav class="navbar navbar-dark bg-dark px-4">
  <span class="navbar-brand fw-bold">🛠 Admin Dashboard</span>
  <a href="/logout" class="btn btn-outline-light btn-sm">Logout</a>
</nav>

<div class="container mt-4">
  <div class="card shadow">
    <div class="card-body">
      <h5 class="mb-3">Applications</h5>

      <table class="table table-bordered table-hover align-middle">
        <thead class="table-dark">
          <tr>
            <th>Application No</th>
            <th>Student Name</th>
            <th>Status</th>
            <th width="35%">Action</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="4" class="text-center">No Applications</td></tr>`}
        </tbody>
      </table>
    </div>
  </div>
</div>

</body>
</html>
`);
});


/* ================= APPROVE / REJECT ================= */
app.get("/approve/:id", isAdmin, async (req, res) => {
  await Application.findByIdAndUpdate(req.params.id, { status: "Approved" });
  res.redirect("/admin-dashboard");
});

app.post("/reject/:id", isAdmin, async (req, res) => {
  const { reason } = req.body;

  await Application.findByIdAndUpdate(req.params.id, {
    status: "Rejected",
    rejectionReason: reason
  });

  res.redirect("/admin-dashboard");
});
app.get("/admin/application/:id", isAdmin, async (req, res) => {
  const appData = await Application.findById(req.params.id);
  if (!appData) return res.send("Application not found");

  const reasonOptions = rejectionReasons
    .map(r => `<option value="${r}">${r}</option>`)
    .join("");

  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>View Application</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
</head>

<body class="bg-light">

<nav class="navbar navbar-dark bg-dark px-4">
  <span class="navbar-brand">📝 Application Review</span>
  <a href="/admin-dashboard" class="btn btn-outline-light btn-sm">⬅ Back</a>
</nav>

<div class="container mt-4">
  <div class="card shadow">
    <div class="card-body">

      <h5 class="mb-3">Student Details</h5>

      <table class="table table-bordered">
        <tr><th>Application No</th><td>${appData.applicationNo}</td></tr>
        <tr><th>Name</th><td>${appData.studentName}</td></tr>
        <tr><th>Father Name</th><td>${appData.fatherName}</td></tr>
        <tr><th>DOB</th><td>${appData.dob}</td></tr>
        <tr><th>Gender</th><td>${appData.gender}</td></tr>
        <tr><th>Student Contact</th><td>${appData.studentContact}</td></tr>
        <tr><th>College</th><td>${appData.collegeName}</td></tr>
        <tr><th>Department</th><td>${appData.department}</td></tr>
        <tr><th>Route</th><td>${appData.startRoute} → ${appData.endRoute}</td></tr>
        <tr><th>Status</th><td>${appData.status}</td></tr>
      </table>

      ${
        appData.status === "Pending"
          ? `
          <div class="row mt-3">
            <div class="col-md-6">
              <a href="/approve/${appData._id}" class="btn btn-success w-100">
                ✅ Approve
              </a>
            </div>

            <div class="col-md-6">
              <form action="/reject/${appData._id}" method="POST">
                <select name="reason" class="form-select mb-2" required>
                  <option value="" disabled selected>
                    -- Select Rejection Reason --
                  </option>
                  ${reasonOptions}
                </select>

                <button class="btn btn-danger w-100">
                  ❌ Reject
                </button>
              </form>
            </div>
          </div>
          `
          : appData.status === "Rejected"
          ? `
            <div class="alert alert-danger mt-3">
              <strong>Rejected Reason:</strong>
              ${appData.rejectionReason}
            </div>
          `
          : `
            <div class="alert alert-success mt-3">
              Application Approved
            </div>
          `
      }

    </div>
  </div>
</div>

</body>
</html>
`);
});




/* ================= ID Card Generation ================= */
const PDFDocument = require("pdfkit");

app.get("/id-card/:id", isAdmin, async (req, res) => {
  const student = await Application.findById(req.params.id);
  if (!student || student.status !== "Approved") {
    return res.send("ID Card available only for approved students");
  }

  const doc = new PDFDocument({ size: "A7", margin: 10 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=BusPass-ID.pdf");

  doc.pipe(res);

  /* CARD BORDER */
  doc.rect(5, 5, 200, 300).stroke();

  /* TITLE */
  doc.fontSize(10).text("STUDENT BUS PASS ID CARD", { align: "center" });
  doc.moveDown(0.5);

  /* STUDENT PHOTO */
  doc.image(student.studentPhoto, 65, 40, { width: 70, height: 80 });

  doc.moveDown(5);

  /* DETAILS */
  doc.fontSize(8);
  doc.text(`Name: ${student.studentName}`);
  doc.text(`College: ${student.collegeName}`);
  doc.text(`Route: ${student.startRoute} - ${student.endRoute}`);
  doc.text(`App No: ${student.applicationNo}`);
  doc.text(`Status: ${student.status}`);

  /* SEAL */
  doc.image("public/seal.png", 15, 220, { width: 40 });

  /* SIGNATURE */
  doc.image("public/principal-sign.png", 130, 220, { width: 50 });

  doc.fontSize(6);
  doc.text("Principal", 140, 260);

  doc.end();
});


/* ================= LOGOUT ================= */
app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/admin"));
});

/* ================= SERVER ================= */

app.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});
