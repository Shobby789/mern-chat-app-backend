const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const app = express();
app.use(express.json());
app.use(cors());
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);
app.use(bodyParser.json());
const Users = require("./models/UserSchema");
const Conversation = require("./models/Conversation");
const Message = require("./models/Message");
const Conversations = require("./models/Conversation");
const SECRET_KEY = "THIS_IS_SECRET_KEY";
const io = require("socket.io")(8080, {
  cors: {
    origin: "http://localhost:3000",
  },
});

const DB =
  "mongodb+srv://smshoaib2001:ChatApp123@cluster0.zxaaz0y.mongodb.net/?retryWrites=true&w=majority";
mongoose
  .connect(DB, {
    useNewUrlParser: true,
  })
  .then(() => console.log("Connected to mongoDB"))
  .catch((e) => console.log(e));

app.get("/", (req, res) => {
  res.send("Success");
});

// socket.io
let users = [];
io.on("connection", (socket) => {
  // console.log("user connected >> ", socket.id);
  socket.on("addUser", (userId) => {
    const isUserExist = users.find((user) => user.userId === userId);
    if (!isUserExist) {
      const user = { userId, socketId: socket.id };
      users.push(user);
      io.emit("getUsers", users);
    }
  });

  socket.on(
    "sendMessage",
    ({ message, conversationId, senderId, recieverId }) => {
      const reciever = users.find((user) => user.id === recieverId);
      const sender = users.find((user) => user.id === senderId);
      // console.log("sender >> ", sender);
      const user = Users.findById(senderId);
      if (reciever) {
        io.to(reciever.socketId)
          .to(sender.socketId)
          .emit("getMessage", {
            senderId,
            message,
            recieverId,
            conversationId,
            user: { id: user._id, fullName: user.fullName, email: user.email },
          });
      }
    }
  );

  socket.on("disconnect", () => {
    users = users.filter((user) => user.socketId !== socket.id);
    io.emit("getUsers", users);
  });
});

app.post("/api/register", async (req, res) => {
  try {
    const { fullName, email, password } = req.body;
    // console.log("Register Data >>>> ", { fullName, email, password });
    const encryptedPassword = await bcrypt.hash(password, 10);
    if (!fullName || !email || !password) {
      res.status(400).send("Please fill all the fields");
    } else {
      const oldUser = await Users.findOne({ email });
      if (oldUser) {
        return res.status(400).send("User Already Exists");
      }
      await Users.create({
        fullName,
        email,
        password: encryptedPassword,
      });
      res.status(200).json({ status: "User created successfully!" });
    }
  } catch (error) {
    res.status(400).send({ status: "User cannot register", error: error });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const checkUser = await Users.findOne({ email });
    if (!checkUser) {
      return res.status(400).send("Email or password is incorrect");
    }
    if (await bcrypt.compare(password, checkUser.password)) {
      const token = jwt.sign({ email: checkUser.email }, SECRET_KEY, {
        expiresIn: "36hr",
      });
      if (res.status(201)) {
        return res.json({
          status: "Login Successfull",
          user: {
            id: checkUser._id,
            fullName: checkUser.fullName,
            email: checkUser.email,
          },
          token,
        });
      } else {
        return res.json(400).send({ status: "Could not login" });
      }
    }
  } catch (error) {
    console.log("trycatch Error:", error);
    res
      .status(400)
      .send({ status: "Server Error", error: "Something went wrong" });
  }
});

app.post("/api/conversation", async (req, res) => {
  try {
    const { senderId, recieverId } = req.body;
    const newConversation = new Conversation({
      members: [senderId, recieverId],
    });
    await newConversation.save();
    res.status(200).send("Conversation created successfully");
  } catch (error) {
    console.log("Conversation could not be created", error);
  }
});

app.get("/api/conversation/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    const conversations = await Conversation.find({
      members: { $in: [userId] },
    });
    const conversationUserData = Promise.all(
      conversations.map(async (conversation) => {
        const recieverId = await conversation.members.find(
          (member) => member !== userId
        );
        const user = await Users.findById(recieverId);
        return {
          user: {
            recieverId: user._id,
            email: user.email,
            fullName: user.fullName,
          },
          conversationId: conversation._id,
        };
      })
    );
    res.status(200).json(await conversationUserData);
  } catch (error) {
    console.log("get conversation api error ", error);
  }
});

app.post("/api/message", async (req, res) => {
  try {
    const { conversationId, senderId, message, recieverId = "" } = req.body;
    // console.log(
    //   "conversationId, senderId, message, recieverId >> ",
    //   conversationId,
    //   senderId,
    //   message,
    //   recieverId
    // );
    if (!senderId || !message)
      return res.status(400).send("Please fill all required fields");
    if (conversationId === "new" && recieverId) {
      const newConversation = new Conversation({
        members: [senderId, recieverId],
      });
      await newConversation.save();
      const newMessage = new Message({
        conversationId: newConversation._id,
        senderId,
        message,
      });
      await newMessage.save();
      return res.status(200).send("Message sent successfully");
    } else if (!conversationId && !recieverId) {
      return res.status(400).send("please fill all the fields");
    }
    const newMessage = new Message({ conversationId, senderId, message });
    await newMessage.save();
    res.status(200).send("Message sent successfully");
  } catch (error) {
    console.log("message send aipi error ", error);
  }
});

app.get("/api/message/:conversationId", async (req, res) => {
  try {
    const checkMessages = async (conversationId) => {
      const messages = await Message.find({ conversationId });
      const messageUserData = Promise.all(
        messages.map(async (message) => {
          const user = await Users.findById(message.senderId);
          return {
            user: { id: user._id, email: user.email, fullName: user.fullName },
            message: message.message,
          };
        })
      );
      res.status(200).json(await messageUserData);
    };
    const conversationId = req.params.conversationId;
    if (conversationId === "new") {
      const checkConversation = Conversation.find({
        members: { $all: [req.query.senderId, req.query.recieverId] },
      });
      if (checkConversation.length > 0) {
        checkMessages(checkConversation[0]._id);
      } else {
        return res.status(200).json([]);
      }
    } else {
      checkMessages(conversationId);
    }
  } catch (error) {
    console.log("Messages api error ", error);
  }
});

app.get("/api/users/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    const users = await Users.find({ _id: { $ne: userId } });
    const usersData = Promise.all(
      users.map(async (user) => {
        return {
          user: {
            recieverId: user._id,
            email: user.email,
            fullName: user.fullName,
          },
        };
      })
    );
    res.status(200).json(await usersData);
  } catch (error) {
    console.log("get all users error ", error);
  }
});

app.listen(1000, () => {
  console.log("Server running on port 1000");
});
