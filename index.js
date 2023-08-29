const express = require('express')
const app = express()
const cors = require('cors')
var jwt = require('jsonwebtoken')
const mg = require('nodemailer-mailgun-transport')
require('dotenv').config()
const nodemailer = require("nodemailer");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY)
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

// let transporter = nodemailer.createTransport({
//   host: 'smtp.sendgrid.net',
//   port: 587,
//   auth: {
//       user: "apikey",
//       pass: process.env.SENDGRID_API_KEY
//   }
// })

const auth = {
  auth: {
    api_key: process.env.Email_Private_Key,
    domain: process.env.Email_Domain
  }
}

const transporter = nodemailer.createTransport(mg(auth));

//Send Payment Confirmation Email
const sendPaymentConfirmationEmail=payment=>{
  transporter.sendMail({
    from: "robynthompson641@gmail.com", // verified sender email
    to: "robynthompson641@gmail.com", // recipient email
    subject: "Test message subject", // Subject line
    text: "Hello world!", // plain text body
    html: `
    <div>
    <h2>Payment Confirmation</h2>
    <p>${payment.transactionId}</p>
    </div>
    `, // html body
  }, function(error, info){
    if (error) {
      console.log(error);
    } else {
      console.log('Email sent: ' + info.response);
    }
  });
}

const verifyJwt = (req,res,next)=>{
  const authorization=req.headers.authorization;
  if(!authorization){
    return res.status(401).send({ error: true, message: 'unauthorized access' });
  }
 // bearer token
 const token=authorization.split(' ')[1];
 jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
  if (err) {
    return res.status(401).send({ error: true, message: 'unauthorized access' })
  }
  req.decoded = decoded;
  next();
})
}

const uri = `mongodb+srv://${process.env.USER_NAME}:${process.env.USER_PASS}@cluster0.jvbgqui.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const usersCollection = client.db("bistroDb").collection("users");
    const menuCollection = client.db("bistroDb").collection("menu");
    const reviewCollection = client.db("bistroDb").collection("reviews");
    const cartCollection = client.db("bistroDb").collection("carts");
    const paymentCollection = client.db("bistroDb").collection("payments");

    //JWT
    app.post('/jwt',(req,res)=>{
      const user=req.body;
      const token=jwt.sign(user,process.env.ACCESS_TOKEN_SECRET,{ expiresIn: '1h' });
      res.send(token);
    })

    // Warning: use verifyJWT before using verifyAdmin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email }
      const user = await usersCollection.findOne(query);
      if (user?.role !== 'admin') {
        return res.status(403).send({ error: true, message: 'forbidden message' });
      }
      next();
    }

    //User Related Api

    app.get('/users',verifyJwt,verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    })
     // security layer: verifyJWT
    // email same
    // check admin
    app.get('/users/admin/:email', verifyJwt, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== email) {
        res.send({ admin: false })
      }

      const query = { email: email }
      const user = await usersCollection.findOne(query);
      const result = { admin: user?.role === 'admin' }
      res.send(result);
    })

    //Update few data
    app.patch('/users/admin/:id',async(req,res)=>{
      const id=req.params.id;
      const filter={_id: new ObjectId(id)};
      const updateDoc={
        $set:{
          role:'admin'
        },
      };
      const result=await usersCollection.updateOne(filter,updateDoc);
      res.send(result);
    })
    app.post('/users',async(req,res)=>{
      const user=req.body;
      const query={email: user.email}
      const existingUser= await usersCollection.findOne(query);
      if(existingUser){
        return res.send({message:'user already exists'});
      }
      const result=await usersCollection.insertOne(user);
      res.send(result);
    })

    //Menu Related Api 
    app.get('/menu', async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result);
    })

    app.post('/menu',verifyJwt, verifyAdmin,async (req,res)=>{
      const newItem=req.body;
      const result=await menuCollection.insertOne(newItem);
      res.send(result);
    })

    app.delete('/menu/:id', verifyJwt, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await menuCollection.deleteOne(query);
      res.send(result);
    })

    app.get('/reviews', async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
    })

    //Cart Collect data

    app.get('/carts',verifyJwt, async (req, res) => {
      const email = req.query.email;
      if (!email) {
        res.send([])
      }
      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res.status(403).send({ error: true, message: 'forbidden access' })
      }
      const query = { email: email }
      const result = await cartCollection.find(query).toArray()
      res.send(result)
    })

    app.post('/carts', async (req, res) => {
      const item = req.body;
      const result = await cartCollection.insertOne(item);
      res.send(result);
    })

    app.delete('/carts/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    })

    //Payment Method
    app.post('/create-payment-intent', verifyJwt, async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card']
      });

      app.post('/payments', verifyJwt, async (req, res) => {
        const payment = req.body;
        const insertResult = await paymentCollection.insertOne(payment);
  
        // this is for delete
        const query = { _id: { $in: payment.cartItems.map(id => new ObjectId(id)) } }
        const deleteResult = await cartCollection.deleteMany(query)

        //Send Email Confirmation
        sendPaymentConfirmationEmail(payment);

        res.send({ insertResult, deleteResult });
      })
  

      res.send({
        clientSecret: paymentIntent.client_secret
      })
    })

    app.get('/addmin-stats', verifyJwt,verifyAdmin, async (req,res)=>{
      const user=await usersCollection.estimatedDocumentCount();
      const product=await menuCollection.estimatedDocumentCount();
      const order=await paymentCollection.estimatedDocumentCount();

      const payment=await paymentCollection.find().toArray();
      const revenue=payment.reduce((sum,payment)=>sum + payment.price,0) 
      res.send({
        user,
        product,
        order,
        revenue
      })
    })

    app.get('/order-stats',verifyJwt, verifyAdmin, async(req, res) =>{
      const pipeline = [
        {
          $lookup: {
            from: 'menu',
            localField: 'menuItems',
            foreignField: '_id',
            as: 'menuItemsData'
          }
        },
        {
          $unwind: '$menuItemsData'
        },
        {
          $group: {
            _id: '$menuItemsData.category',
            count: { $sum: 1 },
            total: { $sum: '$menuItemsData.price' }
          }
        },
        {
          $project: {
            category: '$_id',
            count: 1,
            total: { $round: ['$total', 2] },
            _id: 0
          }
        }
      ];

      const result = await paymentCollection.aggregate(pipeline).toArray()
      res.send(result)

    })

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);



app.get('/', (req, res) => {
  res.send('Bistro server')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})