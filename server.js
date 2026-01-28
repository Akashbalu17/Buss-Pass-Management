const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const session = require("express-session");
const fs = require("fs");
const path = require("path");

const Application = require("./models/Application");
const Admin = require("./models/Admin");

const app = express();

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
<!DOCTYPE html>
<html>
<head>
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
</head>

<body class="bg-light d-flex align-items-center" style="height:100vh">
<div class="container text-center">
  <div class="card shadow p-4">
    <h4 class="text-danger">❌ Application Not Found</h4>
    <a href="/status" class="btn btn-secondary mt-3">Try Again</a>
  </div>
</div>
</body>
</html>
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

        <a href="/status" class="btn btn-secondary mt-3">Check Another</a>
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
  const apps = await Application.find();

  const rows = apps.map(a => `
    <tr>
      <td>${a.applicationNo}</td>
      <td>${a.studentName}</td>
      <td>
        <span class="badge ${
          a.status === "Approved" ? "bg-success" :
          a.status === "Rejected" ? "bg-danger" : "bg-warning"
        }">${a.status}</span>
      </td>
      <td>
        <a href="/approve/${a._id}" class="btn btn-sm btn-success">Approve</a>
        <a href="/reject/${a._id}" class="btn btn-sm btn-danger">Reject</a>
      </td>
      <td>
  <a href="/approve/${a._id}" class="btn btn-sm btn-success">Approve</a>
  <a href="/reject/${a._id}" class="btn btn-sm btn-danger">Reject</a>

  ${a.status === "Approved" ? `
    <a href="/id-card/${a._id}" class="btn btn-sm btn-primary mt-1">
      🎫 ID Card
    </a>` : ""}
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
            <th>Action</th>
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

app.get("/reject/:id", isAdmin, async (req, res) => {
  await Application.findByIdAndUpdate(req.params.id, { status: "Rejected" });
  res.redirect("/admin-dashboard");
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
