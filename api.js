require("dotenv").config();
const mongoclient = require("mongodb").MongoClient;
const express = require("express");
const cors = require("cors");
const { mongo } = require("mongoose");
const connectionstring = "mongodb://127.0.0.1:27017";

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.post("/add-admin", (req, res) => {
  var user = {
    admin_id: req.body.admin_id,
    password: req.body.password,
    mobile: req.body.mobile,
    mail: req.body.mail,
  };
  mongoclient.connect(connectionstring).then((clientObj) => {
    var database = clientObj.db("navanagara");
    database
      .collection("admins")
      .insertOne(user)
      .then(() => {
        (res.send("Admin Added successfully!.."), res.end());
      });
  });
});

app.post("/add-payment", (req, res) => {
  var payment = {
    membershipid: req.body.membershipid,
    receipt_no: req.body.receipt_no,
    date: new Date(req.body.date),
    name: req.body.name,
    projectname: req.body.projectname,
    paymentmode: req.body.paymentmode,
    paymenttype: req.body.paymenttype,
    amountpaid: parseInt(req.body.amountpaid),
  };
  mongoclient.connect(connectionstring).then((clientObj) => {
    var database = clientObj.db("navanagara");
    database
      .collection("payments")
      .insertOne(payment)
      .then(() => {
        res.send("Added Payment Successfully!..");
        res.end();
      });
  });
});

app.post("/add-members", (req, res) => {
  var member = {
    membershipid: req.body.membershipid,
    aadharnumber: parseInt(req.body.aadharnumber),
    applicationno: parseInt(req.body.applicationno),
    membershiptype: req.body.membershiptype,
    date: new Date(req.body.date),
    name: req.body.name,
    dob: new Date(req.body.dob),
    membershipday: req.body.membershipday,
    membershipfees: parseInt(req.body.membershipfees),
    father: req.body.father,
    birthplace: req.body.birthplace,
    mobile: parseInt(req.body.mobile),
    alternatemobile: parseInt(req.body.alternatemobile),
    email: req.body.email,
    alternateemail: req.body.alternateemail,
    permanentaddress: req.body.permanentaddress,
    correspondenceaddress: req.body.correspondenceaddress,
    nomineename: req.body.nomineename,
    nomineenumber: parseInt(req.body.nomineenumber),
    nomineeage: req.body.nomineeage,
    nomineerelationship: req.body.nomineerelationship,
    nomineeaddress: req.body.nomineeaddress,
    agreetermsconditions: Boolean(req.body.agreetermsconditions),
    agreecommunication: Boolean(req.body.agreecommunication),
  };
  mongoclient.connect(connectionstring).then((clientObj) => {
    var database = clientObj.db("navanagara");
    database
      .collection("membership")
      .insertOne(member)
      .then(() => {
        (res.send("Member Added Successfully!.."), res.end());
      });
  });
});

app.post("/site-booking", async (req, res) => {
  try {
    const membershipid = req.body.membershipid;

    if (!membershipid) {
      return res.status(400).send("membershipid is required");
    }

    const clientObj = await mongoclient.connect(connectionstring);
    const database = clientObj.db("navanagara");

    // Fetch member details to get mobile number
    const memberDoc = await database
      .collection("membership")
      .findOne({ membershipid: membershipid });

    if (!memberDoc) {
      return res.status(404).send("Member not found for this membership ID");
    }

    const mobilenumber = memberDoc.mobile; // ✅ Fetch mobile from member

    var fields = {
      membershipid: req.body.membershipid,
      name: req.body.name,
      mobilenumber: mobilenumber, // ✅ Use mobile from member collection
      date: new Date(req.body.date),
      projectname: req.body.projectname,
      sitedimension: req.body.sitedimension,
      transactionid: req.body.transactionid,
      totalamount: parseInt(req.body.totalamount),
      bookingamount: parseInt(req.body.bookingamount),
      downpayment: parseInt(req.body.downpayment),
      installments: parseInt(req.body.installments),
      paymentmode: req.body.paymentmode,
      bank: req.body.bank,
      senioritynumber: req.body.senioritynumber,
    };

    await database.collection("sitebookings").insertOne(fields);
    
    res.send("Created Successfully!..");
    res.end();
  } catch (error) {
    console.error(error);
    res.status(500).send("Error creating site booking");
  }
});

app.post("/receipt", async (req, res) => {
  try {
    const membershipid = req.body.membershipid;

    if (!membershipid) {
      return res.status(400).send("membershipid is required");
    }

    const clientObj = await mongoclient.connect(connectionstring);
    const database = clientObj.db("navanagara");

    // always fetch bookingamount from sitebookings
    const bookingDoc = await database
      .collection("sitebookings")
      .findOne({ membershipid: membershipid });

    const bookingamount = parseInt(bookingDoc?.bookingamount || 0);
    const bank = bookingDoc?.bank || ""; // ✅ fetch bank
    const senioritynumber = bookingDoc?.senioritynumber || ""; // ✅ fetch senioritynumber

    const amountpaid = parseInt(req.body.amountpaid || 0);

    const receipt = {
      membershipid,
      receipt_no: req.body.receipt_no,
      name: req.body.name,
      projectname: req.body.projectname,
      date: new Date(req.body.date),
      amountpaid,
      bookingamount, // ✅ stored
      mobilenumber: parseInt(req.body.mobilenumber),
      totalreceived: bookingamount + amountpaid, // ✅ correct total
      paymentmode: req.body.paymentmode,
      paymenttype: req.body.paymenttype,
      transactionid: req.body.transactionid,
      dimension: req.body.dimension,
      created_by: req.body.created_by,
      bank, // ✅ added from booking
      senioritynumber, // ✅ added from booking
    };

    await database.collection("receipts").insertOne(receipt);

    res.send(receipt); // ✅ return receipt so you can confirm in frontend
  } catch (error) {
    console.error(error);
    res.status(500).send("Error generating receipt");
  }
});

app.put("/backfill-receipts", async (req, res) => {
  try {
    const clientObj = await mongoclient.connect(connectionstring);
    const database = clientObj.db("navanagara");

    const receipts = await database.collection("receipts").find({}).toArray();
    let updated = 0;

    for (const r of receipts) {
      if (!r.membershipid) continue;

      // already has bookingamount? skip
      if (r.bookingamount != null && r.totalreceived != null) continue;

      const bookingDoc = await database
        .collection("sitebookings")
        .findOne({ membershipid: r.membershipid });

      const bookingamount = Number(bookingDoc?.bookingamount || 0);
      const amountpaid = Number(r.amountpaid || 0);

      await database.collection("receipts").updateOne(
        { _id: r._id },
        {
          $set: {
            bookingamount,
            totalreceived: bookingamount + amountpaid,
          },
        },
      );

      updated++;
    }

    res.send(`✅ Updated ${updated} receipt(s).`);
  } catch (err) {
    console.error(err);
    res.status(500).send("❌ Backfill failed");
  }
});

app.put("/update-member/:id", (req, res) => {
  var member = {
    membershipid: req.body.membershipid,
    aadharnumber: parseInt(req.body.aadharnumber),
    applicationno: parseInt(req.body.applicationno),
    membershiptype: req.body.membershiptype,
    date: new Date(req.body.date),
    name: req.body.name,
    dob: new Date(req.body.dob),
    membershipday: req.body.membershipday,
    membershipfees: parseInt(req.body.membershipfees),
    father: req.body.father,
    birthplace: req.body.birthplace,
    mobile: parseInt(req.body.mobile),
    alternatemobile: parseInt(req.body.alternatemobile),
    email: req.body.email,
    alternateemail: req.body.alternateemail,
    permanentaddress: req.body.permanentaddress,
    correspondenceaddress: req.body.correspondenceaddress,
    nomineename: req.body.nomineename,
    nomineenumber: parseInt(req.body.nomineenumber),
    nomineeage: req.body.nomineeage,
    nomineerelationship: req.body.nomineerelationship,
    nomineeaddress: req.body.nomineeaddress,
    agreetermsconditions: Boolean(req.body.agreetermsconditions),
    agreecommunication: Boolean(req.body.agreecommunication),
  };
  mongoclient.connect(connectionstring).then((clientObj) => {
    var database = clientObj.db("navanagara");
    database
      .collection("membership")
      .updateOne({ membershipid: req.params.id }, { $set: member })
      .then(() => {
        res.send("Successfully Updated!..");
        res.end();
      });
  });
});

app.put("/update-sitebooking/:id", (req, res) => {
  var fields = {
    membershipid: req.body.membershipid,
    name : req.body.name,
    projectname: req.body.projectname,
    date: new Date(req.body.date),
    sitedimension: req.body.sitedimension,
    transactionid: req.body.transactionid,
    totalamount: parseInt(req.body.totalamount),
    bookingamount: parseInt(req.body.bookingamount),
    downpayment: parseInt(req.body.downpayment),
    installments: req.body.installments,
    paymentmode: req.body.paymentmode,
    senioritynumber: req.body.senioritynumber,
  };
  mongoclient.connect(connectionstring).then((clientObj) => {
    var database = clientObj.db("navanagara");
    database
      .collection("sitebookings")
      .updateOne({ membershipid: req.params.id }, { $set: fields })
      .then(() => {
        res.send("updated Successfully!..");
        res.end();
      });
  });
});

app.put("/edit-admin/:id", (req, res) => {
  var user = {
    admin_id: req.body.admin_id,
    password: req.body.password,
    mobile: req.body.mobile,
    mail: req.body.mail,
  };
  mongoclient.connect(connectionstring).then((clientObj) => {
    var database = clientObj.db("navanagara");
    database
      .collection("admins")
      .updateOne({ admin_id: req.params.id }, { $set: user })
      .then(() => {
        res.send("Updated the admin successfully!..");
        res.end();
      });
  });
});

app.get("/payments", (req, res) => {
  mongoclient.connect(connectionstring).then((clientObj) => {
    var database = clientObj.db("navanagara");
    database
      .collection("payments")
      .find({})
      .toArray()
      .then((document) => {
        res.send(document);
        res.end();
      });
  });
});

// app.put("/update-receipt/:id", (req,res)=>{
//     var fields = {
//         receipt_no: req.body.receipt_no,
//         date: new Date(req.body.date),
//         amountpaid: parseInt(req.body.amountpaid),
//         paymentmode: req.body.paymentmode,
//         transactionid: req.body.transactionid,
//         dimension: req.body.dimension,
//         created_by: req.body.created_by
//     }
//     mongoclient.connect(connectionstring).then(clientObj=>{
//         var database = clientObj.db("navanagara");
//         database.collection("receipts").updateOne({receipt_no:req.params.id},{$set:fields}).then(()=>{
//             res.send("Updated the Receipt!..");
//             res.end();
//         })
//     })
// });

app.get("/admins", (req, res) => {
  mongoclient.connect(connectionstring).then((clientObj) => {
    var database = clientObj.db("navanagara");
    database
      .collection("admins")
      .find({})
      .toArray()
      .then((document) => {
        res.send(document);
        res.end();
      });
  });
});

app.get("/receipts", (req, res) => {
  mongoclient.connect(connectionstring).then((clientObj) => {
    var database = clientObj.db("navanagara");
    database
      .collection("receipts")
      .find({})
      .toArray()
      .then((document) => {
        res.send(document);
        res.end();
      });
  });
});

app.get("/sitebookings", (req, res) => {
  mongoclient.connect(connectionstring).then((clientObj) => {
    var database = clientObj.db("navanagara");
    database
      .collection("sitebookings")
      .find({})
      .toArray()
      .then((document) => {
        res.send(document);
        res.end();
      });
  });
});

app.get("/members", (req, res) => {
  mongoclient.connect(connectionstring).then((clientObj) => {
    var database = clientObj.db("navanagara");
    database
      .collection("membership")
      .find({})
      .toArray()
      .then((document) => {
        res.send(document);
        res.end();
      });
  });
});

app.listen(3001);
console.log(`Server running http://127.0.0.1:3001`);
