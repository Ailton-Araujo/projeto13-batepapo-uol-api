import Joi from "joi";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";
import express, { json } from "express";
import cors from "cors";
import dayjs from "dayjs";
import { stripHtml } from "string-strip-html";

// Templates to data validation
const schemaUser = Joi.object({
  name: Joi.string().required(),
});

const schemaMessage = Joi.object({
  to: Joi.string().min(1).required(),
  text: Joi.string().min(1).required(),
  type: Joi.any().valid("message", "private_message").required(),
});

const schemaLimit = Joi.number().integer().greater(0);

// App setting
const app = express();
// Configs
app.use(cors());
app.use(json());
dotenv.config();

// DataBase connect
const mongoClient = new MongoClient(process.env.DATABASE_URL);

try {
  await mongoClient.connect();
  console.log("MongoDB Connected!");
} catch (err) {
  console.log(err.message);
}
const db = mongoClient.db();

//-------------------------------EndPoints-------------------------------//

// Participants
app.post("/participants", async (req, res) => {
  const { name } = req.body;

  const validation = schemaUser.validate(req.body, { abortEarly: false });

  if (validation.error) {
    const errors = validation.error.details.map((detail) => detail.message);
    return res.status(422).send(errors);
  }

  try {
    const user = await db.collection("participants").findOne({ name: name });
    if (user)
      return res.status(409).send("Este nome de Usuário já está em uso");
    const date = Date.now();

    const promise1 = db
      .collection("participants")
      .insertOne({ name, lastStatus: date });

    const promise2 = db.collection("messages").insertOne({
      from: name,
      to: "Todos",
      text: "entra na sala...",
      type: "status",
      time: dayjs(date).format("HH:mm:ss"),
    });

    await promise1;
    await promise2;
    res.sendStatus(201);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get("/participants", async (req, res) => {
  try {
    const participants = await db.collection("participants").find().toArray();
    res.send(participants);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Messages
app.post("/messages", async (req, res) => {
  const from = req.headers.user;
  const { to, text, type } = req.body;

  const validation = schemaMessage.validate(req.body, { abortEarly: false });

  if (validation.error) {
    const errors = validation.error.details.map((detail) => detail.message);
    return res.status(422).send(errors);
  }
  try {
    const user = await db.collection("participants").findOne({ name: from });
    if (!user) return res.status(422).send("Usuário não encontrado");

    await db.collection("messages").insertOne({
      from,
      to,
      text,
      type,
      time: dayjs(Date.now()).format("HH:mm:ss"),
    });
    res.sendStatus(201);
  } catch (error) {
    res.status(500).send(err.message);
  }
});

app.get("/messages", async (req, res) => {
  const name = req.headers.user;
  const { limit } = req.query;

  const validation = schemaLimit.validate(limit);

  if (validation.error) {
    const errors = validation.error.details.map((detail) => detail.message);
    return res.status(422).send(errors);
  }

  try {
    if (limit !== undefined) {
      const messages = await db
        .collection("messages")
        .find({ $or: [{ to: "Todos" }, { from: name }, { to: name }] })
        .sort({ $natural: -1 })
        .limit(Number(limit))
        .toArray();
      return res.send(messages);
    }

    const messages = await db
      .collection("messages")
      .find({ $or: [{ to: "Todos" }, { from: name }, { to: name }] })
      .toArray();
    res.send(messages);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Message by ID
app.delete("/messages/:id", async (req, res) => {
  const from = req.headers.user;
  const { id } = req.params;

  try {
    const message = await db
      .collection("messages")
      .findOne({ _id: new ObjectId(id) });
    if (!message) return res.status(404).send("Essa mensagem não exite");
    if (!(message.from === from)) return res.sendStatus(401);

    await db.collection("messages").deleteOne(message);
    res.status(200).send("Mensagem deletada com sucesso!");
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.put("/messages/:id", async (req, res) => {});

// Status
app.post("/status", async (req, res) => {
  const name = req.headers.user;
  if (name === undefined) return res.sendStatus(404);

  try {
    const user = await db.collection("participants").findOne({ name: name });
    if (!user) return res.sendStatus(404);

    await db
      .collection("participants")
      .updateOne({ name: name }, { $set: { lastStatus: Date.now() } });
    res.sendStatus(200);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Remove inactive Users

setInterval(async () => {
  try {
    const inatives = await db
      .collection("participants")
      .find({ lastStatus: { $lt: Date.now() - 10000 } })
      .toArray();

    inatives.forEach(async (participant) => {
      const promise1 = db.collection("messages").insertOne({
        from: participant.name,
        to: "Todos",
        text: "sai da sala...",
        type: "status",
        time: dayjs(Date.now()).format("HH:mm:ss"),
      });
      const promise2 = db
        .collection("participants")
        .deleteOne({ _id: participant._id });
      await promise1;
      await promise2;
    });
  } catch (err) {
    console.log(err.message);
  }
}, 15000);

// Server Listener
const PORT = 5000;
app.listen(PORT, () => console.log(`Servidor está rodando na porta ${PORT}`));
