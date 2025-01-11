const express = require('express');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
const port = process.env.PORT || 5000;
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ybs8l.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

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

    const menuCollection = client.db("mz_bossDB").collection("menu");
    const reviewCollection = client.db("mz_bossDB").collection("reviews");
    const cartCollection = client.db("mz_bossDB").collection("carts");
    const userCollection = client.db("mz_bossDB").collection("users");
    const paymentCollection = client.db("mz_bossDB").collection("payments");

    // JWT related API
    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
      res.send({ token });
    })

    // Middlewares
    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send({ message: 'Unauthorized Access' })
      }

      const token = req.headers.authorization.split(' ')[1];

      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (error, decoded) => {
        if (error) {
          return res.status(401).send({ message: 'Unauthorized Access' })
        }

        req.decoded = decoded;
        next();
      })
    };

    // Use verify admin after verifyToken
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };

      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === 'admin';

      if (!isAdmin) {
        return res.status(403).send({ message: "Forbidden Access" });
      }

      next();
    };

    app.get("/menu", async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result);
    });

    app.get("/menu/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: id };
      const result = await menuCollection.findOne(query);
      res.send(result);
    });

    app.post('/menu', verifyToken, verifyAdmin, async (req, res) => {
      const item = req.body;
      const result = await menuCollection.insertOne(item);
      res.send(result);
    });

    app.patch("/menu/:id", verifyToken, verifyAdmin, async (req, res) => {
      const item = req.body;
      const id = req.params.id;
      const filter = { _id: id };

      const updatedDoc = {
        $set: {
          name: item?.name,
          category: item?.category,
          price: item?.price,
          recipe: item?.recipe,
          image: item?.image
        }
      }

      const updateResult = await menuCollection.updateOne(filter, updatedDoc);

      res.send(updateResult);
    });

    app.delete("/menu/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: id };
      const result = await menuCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/reviews", async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
    });

    // Payment API
    app.get("/payments/:email", verifyToken, async (req, res) => {
      const query = { email: req.params.email };

      if (req.params.email !== req.decoded.email) {
        return res.status(403).send({ message: "Forbidden Access" })
      }

      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card'],
      })

      res.send({ clientSecret: paymentIntent.client_secret });
    });

    app.post("/payments", async (req, res) => {
      const paymentInfo = req.body;
      // console.log(paymentInfo);
      const paymentResult = await paymentCollection.insertOne(paymentInfo);

      const query = {
        _id: {
          $in: paymentInfo.cartIds.map(id => new ObjectId(id))
        }
      };

      const deleteResult = await cartCollection.deleteMany(query);
      res.send({ paymentResult, deleteResult });
    });

    // Stats

    app.get("/admin-stats", verifyToken, verifyAdmin, async(req, res) => {
      const users = await userCollection.estimatedDocumentCount();
      const menuItems = await menuCollection.estimatedDocumentCount();
      const orders = await paymentCollection.estimatedDocumentCount();

      // const paymentResult = await paymentCollection.find().toArray();
      // const revenue = paymentResult.reduce((total, payment) => total + payment.price, 0);

      const result = await paymentCollection.aggregate([
        {
          $group: {
            _id: null,
            totalRevenue: {
              $sum: '$price'
            }
          }
        }
      ]).toArray();

      const revenue = result.length > 0 ? result[0].totalRevenue : 0;

      res.send({users, menuItems, orders, revenue});
    });

    // Cart collection
    app.get("/carts", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const getResult = await cartCollection.find(query).toArray();
      res.send(getResult);
    });

    app.post("/carts", async (req, res) => {
      const cartItem = req.body;
      const result = await cartCollection.insertOne(cartItem);
      res.send(result);
    });

    app.delete("/cart/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await cartCollection.deleteOne(query);
      res.send(result);
    });

    //  User Collection
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.get("/user/admin/:email", async (req, res) => {
      const email = req.params.email;
      // if (email !== req.decoded.email) {
      //   return res.status(403).send({ message: 'Forbidden Access' })
      // }

      const query = { email: email };
      const user = await userCollection.findOne(query);

      let admin = false;
      if (user) {
        admin = user?.role === 'admin'
      }

      res.send({ admin });
    });

    app.post("/users", async (req, res) => {
      const usersData = req.body;
      const query = { email: usersData?.email };
      const existingUser = await userCollection.findOne(query);

      if (existingUser) {
        return res.send({ message: 'User already exists', insertedId: null });
      }

      const result = await userCollection.insertOne(usersData);
      res.send(result);
    });

    app.patch("/users/admin/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          role: 'admin'
        }
      }
      const result = await userCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });

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
  res.send('Mahim Boss is Sitting');
});

app.listen(port, () => {
  console.log(`MZ Boss is sitting on port ${port}`);
});