const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const session = require("express-session");
const fs = require("fs");
const path = require("path");

const Application = require("./models/Application");
const Admin = require("./models/Admin");
const Student = require("./models/student");

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


//CREATE UPLOAD FOLDERS 
["uploads", "uploads/photos", "uploads/aadhaar", "uploads/idproof","uploads/bonafide"].forEach(f => {
  if (!fs.existsSync(f)) fs.mkdirSync(f, { recursive: true });
});

//MIDDLEWARE
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/uploads", express.static("uploads"));
app.use(express.static("public"));

app.use(session({
  secret: "buspass_secret",
  resave: false,
  saveUninitialized: false
}));
function isStudent(req, res, next) {
  if (!req.session.student) return res.redirect("/student-login");
  next();
}
app.get("/apply", isStudent, (req, res) => {
  res.sendFile(path.resolve("public/apply.html"));
});
app.get("/student-logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});


// DATABASE 
mongoose.connect("mongodb://127.0.0.1:27017/buspassDB")
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

//MULTER STORAGE
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const map = {
      studentPhoto: "uploads/photos",
      aadhaarFile: "uploads/aadhaar",
      idProof: "uploads/idproof",
      bonafide: "uploads/bonafide"
    };

    if (!map[file.fieldname]) {
      console.error("❌ Unexpected field:", file.fieldname);
      return cb(null, "uploads"); // 👈 DO NOT THROW ERROR
    }

    cb(null, map[file.fieldname]);
  },

  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const upload = multer({ storage });

app.get("/student-register", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<title>Student Register</title>
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body class="bg-light">

<div class="container mt-5">
  <div class="row justify-content-center">
    <div class="col-md-4">
      <div class="card shadow p-4">
        <h4 class="text-center mb-3">🎓 Student Registration</h4>

        <form method="POST" action="/student-register">
          <input class="form-control mb-3" name="name" placeholder="Student Name" required>
          <input type="email" class="form-control mb-3" name="email" placeholder="Email" required>
          <input type="password" class="form-control mb-3" name="password" placeholder="Password" required>

          <button class="btn btn-primary w-100">Register</button>
        </form>

        <div class="text-center mt-3">
          <a href="/student-login">Already have an account?</a>
        </div>
      </div>
    </div>
  </div>
</div>

</body>
</html>
`);
});



app.post("/student-register", async (req, res) => {
  await Student.create(req.body);
  res.redirect("/student-login");
});

app.get("/student-login", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<title>Student Login</title>
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body class="bg-light">

<div class="container mt-5">
  <div class="row justify-content-center">
    <div class="col-md-4">
      <div class="card shadow p-4">
        <h4 class="text-center mb-3">🔐 Student Login</h4>

        <form method="POST">
          <input type="email" class="form-control mb-3" name="email" placeholder="Email" required>
          <input type="password" class="form-control mb-3" name="password" placeholder="Password" required>

          <button class="btn btn-success w-100 mb-2">Login</button>
        </form>

        <!-- REGISTER BUTTON -->
        <div class="text-center mt-3">
          <p class="mb-1">New Student?</p>
          <a href="/student-register" class="btn btn-outline-primary w-100">
            Register Here
          </a>
        </div>

      </div>
    </div>
  </div>
</div>

</body>
</html>
`);
});

app.post("/student-login", async (req, res) => {
  const student = await Student.findOne(req.body);
  if (!student) return res.send("❌ Invalid Login");

  req.session.student = student._id;
  res.redirect("/apply");
});


// HOME 
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Bus Pass System</title>

<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">

<style>
html, body {
  height: 100%;
  margin: 0;
}

.hero {
  height: 100vh;
  background:
    linear-gradient(rgba(0,0,0,0.65), rgba(0,0,0,0.65)),
    url("https://images.unsplash.com/photo-1544620347-c4fd4a3d5957");
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  color: white;
}



.hero > * {
  position: relative;
  z-index: 1;
}

.navbar {
  background: transparent !important;
}

.nav-link,
.navbar-brand {
  color: white !important;
  font-weight: 500;
}

.nav-link:hover {
  color: #00ffcc !important;
}

.hero-content {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  width: 90%;
}

.hero-content h1 {
  font-size: 3rem;
  font-weight: 700;
}

.hero-content p {
  font-size: 1.2rem;
  margin-top: 15px;
}
</style>
</head>

<body>

<div class="hero">

<nav class="navbar navbar-expand-lg navbar-dark">
  <div class="container-fluid">
    <a class="navbar-brand" href="/">Bus Pass Management</a>

    <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#nav">
      <span class="navbar-toggler-icon"></span>
    </button>

    <div class="collapse navbar-collapse" id="nav">
      <ul class="navbar-nav ms-auto">
        <li class="nav-item"><a class="nav-link" href="/">Home</a></li>
        <li class="nav-item"><a class="nav-link" href="/student-login">Sign in</a></li>
        <li class="nav-item"><a class="nav-link" href="/student-register">Sign up</a></li>
        <li class="nav-item"><a class="nav-link" href="/admin">Admin</a></li>
      </ul>
    </div>
  </div>
</nav>

<div class="hero-content">
  <h1>Tamil Nadu State Transport Corporation</h1>
  <p>Smart Digital Bus Pass Management System</p>

  <div class="mt-4 d-flex justify-content-center gap-3 flex-wrap">
    <a href="/student-login" class="btn btn-primary px-4">Apply Bus Pass</a>
    <a href="/status" class="btn btn-outline-light px-4">Check Status</a>
  </div>
</div>

</div>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html>
`);
});



app.get("/apply", (req, res) => {
  res.sendFile(path.resolve("public/apply.html"));
});



//APPLY POST 
app.post(
  "/apply",
  upload.fields([
    { name: "studentPhoto", maxCount: 1 },
    { name: "aadhaarFile", maxCount: 1 },
    { name: "idProof", maxCount: 1 },
    { name: "bonafide", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      console.log("BODY:", req.body);
      console.log("FILES:", req.files);

      await Application.create({
        ...req.body,
        studentPhoto: req.files.studentPhoto[0].path,
        aadhaarFile: req.files.aadhaarFile[0].path,
        idProof: req.files.idProof[0].path,
        bonafide: req.files.bonafide[0].path
      });

      res.redirect(`/application-success.html?appNo=${req.body.applicationNo}`);

    } catch (err) {
      console.error("APPLY ERROR:", err);
      res.status(500).send("❌ Error submitting application");
    }
  }
);

//STATUS PAGE
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


//STATUS CHECK 
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


// ADMIN LOGIN PAGE 
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

// ADMIN LOGIN LOGIC 
app.post("/admin-login", async (req, res) => {
  const admin = await Admin.findOne(req.body);
  if (!admin) return res.send("❌ Invalid Login");

  req.session.admin = true;
  res.redirect("/admin-dashboard");
});

//ADMIN AUTH 
function isAdmin(req, res, next) {
  if (!req.session.admin) return res.redirect("/admin");
  next();
}

/* ================= ADMIN DASHBOARD ================= */
app.get("/admin-dashboard", isAdmin, async (req, res) => {
  const apps = await Application.find().sort({ createdAt: -1 });

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

      <td class="text-center">
        <a href="/admin/application/${a._id}"
           class="btn btn-primary btn-sm w-100">
          👁 View Application
        </a>
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

<nav class="navbar navbar-dark bg-primary px-4">
  <span class="navbar-brand">🛠 Admin Dashboard</span>
  <a href="/logout" class="btn btn-light btn-sm">Logout</a>
</nav>

<div class="container mt-4">
  <div class="card shadow p-4">

    <h4 class="mb-3">Student Applications</h4>

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
        ${rows || `<tr><td colspan="4" class="text-center">No applications found</td></tr>`}
      </tbody>
    </table>

  </div>
</div>

</body>
</html>
`);
});


// ADMIN ANALYTICS 
app.get("/admin-analytics", isAdmin, async (req, res) => {


  console.log("ADMIN ANALYTICS OPENED");

  try {
    const apps = await Application.find();

    const total = apps.length;
    const approved = apps.filter(a => a.status === "Approved").length;
    const rejected = apps.filter(a => a.status === "Rejected").length;
    const pending = apps.filter(a => a.status === "Pending").length;

    res.send(`
<!DOCTYPE html>
<html>
<head>
<title>Admin Analytics</title>
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
</head>

<body class="bg-light">

<nav class="navbar navbar-dark bg-dark px-4">
  <span class="navbar-brand">📊 Analytics Dashboard</span>
  <a href="/admin-dashboard" class="btn btn-outline-light btn-sm">⬅ Back</a>
</nav>

<div class="container mt-4">
  <div class="row g-3">

    <div class="col-md-3">
      <div class="card shadow text-center p-3">
        <h5>Total Applications</h5>
        <h2>${total}</h2>
      </div>
    </div>

    <div class="col-md-3">
      <div class="card shadow text-center p-3 text-success">
        <h5>Approved</h5>
        <h2>${approved}</h2>
      </div>
    </div>

    <div class="col-md-3">
      <div class="card shadow text-center p-3 text-danger">
        <h5>Rejected</h5>
        <h2>${rejected}</h2>
      </div>
    </div>

    <div class="col-md-3">
      <div class="card shadow text-center p-3 text-warning">
        <h5>Pending</h5>
        <h2>${pending}</h2>
      </div>
    </div>

  </div>
</div>

</body>
</html>
`);
  } catch (err) {
    console.error(err);
    res.send("Error loading analytics");
  }
});


//APPROVE / REJECT
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

  const rejectionOptions = rejectionReasons
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

<nav class="navbar navbar-dark bg-primary px-4">
  <span class="navbar-brand">📄 Application Details</span>
  <a href="/admin-dashboard" class="btn btn-light btn-sm">Back</a>
</nav>

<div class="container mt-4">
  <div class="card shadow p-4">

    <h4 class="mb-3">Application Information</h4>

    <p><b>Application No:</b> ${appData.applicationNo}</p>
    <p><b>Student Name:</b> ${appData.studentName}</p>
    <p><b>College:</b> ${appData.collegeName}</p>
    <p><b>Route:</b> ${appData.startRoute} → ${appData.endRoute}</p>
    <p>
      <b>Status:</b>
      <span class="badge ${
        appData.status === "Approved" ? "bg-success" :
        appData.status === "Rejected" ? "bg-danger" :
        "bg-warning text-dark"
      }">
        ${appData.status}
      </span>
    </p>

    <hr>

    <h5>Uploaded Documents</h5>
    <ul>
      <li><a href="/${appData.studentPhoto}" target="_blank">Student Photo</a></li>
      <li><a href="/${appData.aadhaarFile}" target="_blank">Aadhaar</a></li>
      <li><a href="/${appData.idProof}" target="_blank">College ID</a></li>
      <li><a href="/${appData.bonafide}" target="_blank">Bonafide</a></li>
    </ul>

    ${
      appData.status === "Pending"
        ? `
        <hr>

        <div class="row mt-4">
          <div class="col-md-6">
            <a href="/approve/${appData._id}" 
               class="btn btn-success w-100">
              ✅ Approve Application
            </a>
          </div>

          <div class="col-md-6">
            <form method="POST" action="/reject/${appData._id}">
              <select name="reason" class="form-select mb-2" required>
                <option value="" disabled selected>
                  Select rejection reason
                </option>
                ${rejectionOptions}
              </select>

              <button class="btn btn-danger w-100">
                ❌ Reject Application
              </button>
            </form>
          </div>
        </div>
        `
        : `
        <div class="alert mt-4 ${
          appData.status === "Approved" ? "alert-success" : "alert-danger"
        }">
          This application has already been ${appData.status}.
        </div>
        `
    }

  </div>
</div>

</body>
</html>
`);
});


// ID Card Generation
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

  //CARD BORDER
  doc.rect(5, 5, 200, 300).stroke();

  // TITLE 
  doc.fontSize(10).text("STUDENT BUS PASS ID CARD", { align: "center" });
  doc.moveDown(0.5);

  //STUDENT PHOTO
  doc.image(student.studentPhoto, 65, 40, { width: 70, height: 80 });

  doc.moveDown(5);

  //DETAILS 
  doc.fontSize(8);
  doc.text(`Name: ${student.studentName}`);
  doc.text(`College: ${student.collegeName}`);
  doc.text(`Route: ${student.startRoute} - ${student.endRoute}`);
  doc.text(`App No: ${student.applicationNo}`);
  doc.text(`Status: ${student.status}`);

  //SEAL
  doc.image("public/seal.png", 15, 220, { width: 40 });

  //SIGNATURE
  doc.image("public/principal-sign.png", 130, 220, { width: 50 });

  doc.fontSize(6);
  doc.text("Principal", 140, 260);

  doc.end();
});


//LOGOUT 
app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/admin"));
});

// SERVER 

app.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});
