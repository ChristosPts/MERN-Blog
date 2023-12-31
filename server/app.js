const express = require('express');
const app = express();
const cors = require('cors');
const mongoose = require('mongoose');
const User = require('./models/user');
const Post = require('./models/post');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const uploadMiddleware = multer({ dest: 'uploads/' });
const fs = require('fs');

const salt = bcrypt.genSaltSync(10);
const secret = "diwjo123waEPLj190";
const PORT = 5000;

app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(__dirname + '/uploads'));

mongoose.set('strictQuery', false);
mongoose.connect('mongodb+srv://<user>:<password>@<database>.mongodb.net/?retryWrites=true&w=majority');

  app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    try {
      const userDoc = await User.create({
        username,
        password: bcrypt.hashSync(password, salt),
      });
      res.json(userDoc);
    } catch (e) {
      res.status(400).json(e);
    }
  });

  app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const userDoc = await User.findOne({ username });
  
    if (!userDoc) {
      return res.status(400).json({ error: 'User not found' });
    }
  
    const passCheck = bcrypt.compareSync(password, userDoc.password);
    if (passCheck) {
      // logged in
      jwt.sign({ username, id: userDoc._id }, secret, {}, (err, token) => {
        if (err) throw err;
        res.cookie('token', token, { httpOnly: true }).json({
          id: userDoc._id,
          username,
        });
      });
    } else {
      res.status(400).json({ error: 'Wrong credentials' });
    }
  });

  app.get('/profile', (req, res) => {
    const { token } = req.cookies;
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    jwt.verify(token, secret, {},(err, info) => {
      if (err) throw err;
        res.json(info);
    });
  });

  app.post('/logout', (req, res) => {
    res.clearCookie('token').json({ message: 'Logged out successfully' });
  });

  //Creating new post
  app.post('/post', uploadMiddleware.single('file'), async (req, res) => {
    const { originalname, path } = req.file;
    const parts = originalname.split('.');
    const ext = parts[parts.length - 1];
    const newPath = path + '.' + ext;
  
    fs.renameSync(path, newPath);
  
    const { token } = req.cookies;
    jwt.verify(token, secret, {}, async (err, info) => {
      if (err) {
        res.status(401).json({ error: 'Invalid token' });
        return;
      }
  
      const { title, summary, content } = req.body;
      const postDoc = await Post.create({
        title,
        summary,
        content,
        cover: newPath,
        author: info.id, // Ensure that 'author' is set to the user ID
      });
  
      res.json(postDoc);
    });
  });
  

  //Updating post
  app.put('/post/:id', uploadMiddleware.single('file'), async (req, res) => {
    const { id } = req.params; // Get the post ID from the URL parameter
    let newPath = null;
    
    const { token } = req.cookies;
    jwt.verify(token, secret, {}, async (err, info) => {
      if (err) {
        res.status(401).json({ error: 'Invalid token' });
        return;
      }
  
      const { title, summary, content } = req.body;
      const postDoc = await Post.findById(id); // Find the post by ID
      if (!postDoc) {
        res.status(404).json({ error: 'Post not found' });
        return;
      }
  
      const isAuthor = JSON.stringify(postDoc.author) === JSON.stringify(info.id);
      if (!isAuthor) {
        res.status(403).json({ error: 'Unauthorized' });
        return;
      }

    if (req.file) {
      if (postDoc.cover) {
        fs.unlinkSync(__dirname + '/' + postDoc.cover);
      }
      const { originalname, path } = req.file;
      const parts = originalname.split('.');
      const ext = parts[parts.length - 1];
      newPath = path + '.' + ext;
      fs.renameSync(path, newPath);
    }
  
      await postDoc.updateOne({
        title,
        summary,
        content,
        cover: newPath ? newPath : postDoc.cover,
      });
  
      res.json(postDoc);
    });
  });

//fetching posts
  app.get('/post', async (req, res) => {
    try {
      const posts = await Post.find()
        .populate('author', ['username'])
        .sort({ createdAt: -1 }) // Sort by 'createdAt' field in descending order
        .limit(24); // Limit the results to 20 posts
  
      res.json(posts);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  
 //fetching a single post
  app.get('/post/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const postDoc = await Post.findById(id).populate('author', ['username']);
      if (!postDoc) {
        return res.status(404).json({ error: 'Post not found' });
      }
      res.json(postDoc);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });


  app.delete('/post/:id', async (req, res) => {
    const { id } = req.params;
  
    const { token } = req.cookies;
    jwt.verify(token, secret, {}, async (err, info) => {
      if (err) {
        res.status(401).json({ error: 'Invalid token' });
        return;
      }
  
      try {
        const postDoc = await Post.findById(id); // Find the post by ID
        if (!postDoc) {
          res.status(404).json({ error: 'Post not found' });
          return;
        }
  
        const isAuthor = JSON.stringify(postDoc.author) === JSON.stringify(info.id);
        if (!isAuthor) {
          res.status(403).json({ error: 'Unauthorized' });
          return;
        }
  
        // Delete the image from the 'uploads' folder
        fs.unlinkSync(__dirname + '/' + postDoc.cover);
  
        // Delete the post from the database
        await postDoc.remove();
  
        res.json({ message: 'Post deleted successfully' });
      } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  });

  app.get('/profile/:authorId', async (req, res) => {
    const { authorId } = req.params;

    try {
      // Find the user by the given authorId
      const user = await User.findById(authorId);

      if (!user) {
        return res.status(404).json({ error: 'Author not found' });
      }

      // Find posts by the authorId and populate the 'author' field with 'username'
      const posts = await Post.find({ author: authorId })
        .populate('author', ['username'])
        .sort({ createdAt: -1 })
        .limit(20); 
      res.json({ author: user.username, posts });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/profile/:authorId', async (req, res) => {
    const { authorId } = req.params;
    

    try {
      const posts = await Post.find({ author: authorId });
      posts.forEach((post) => {
        if (post.cover) {
          fs.unlinkSync(__dirname + '/' + post.cover);
        }
      });

      await Post.deleteMany({ author: authorId });
      await User.findByIdAndDelete(authorId);
      res.json({ message: 'User and associated posts deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
 

  });


  app.listen(PORT, () => {
    console.log(`App listening on port ${PORT}`);
  });
