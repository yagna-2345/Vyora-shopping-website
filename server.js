require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 8000;
const MONGODB_URI = process.env.MONGODB_URI;

// Setup directories and files for JSON databases (fallback)
const DATA_DIR = path.join(__dirname, 'data');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}
if (!fs.existsSync(PRODUCTS_FILE)) {
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify([]));
}
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify([]));
}

// Mongoose Schemas & Models
const reviewSchema = new mongoose.Schema({
  id: String,
  username: String,
  rating: Number,
  comment: String,
  createdAt: String
}, { _id: false });

const productSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  gender: String,
  category: String,
  description: String,
  images: [String],
  sizes: { type: mongoose.Schema.Types.Mixed, default: {} },
  stock: { type: Number, default: 0 },
  reviews: [reviewSchema],
  createdAt: String
});

const userSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }
});

const ProductModel = mongoose.model('Product', productSchema);
const UserModel = mongoose.model('User', userSchema);

let isMongoConnected = false;

// Read/write helpers for JSON fallback
function readJSONFile(filePath) {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
    return [];
  }
}

function writeJSONFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error(`Error writing ${filePath}:`, error);
  }
}

// Connect to MongoDB if MONGODB_URI is provided
async function connectDB() {
  if (MONGODB_URI) {
    try {
      await mongoose.connect(MONGODB_URI);
      isMongoConnected = true;
      console.log('✅ Connected to MongoDB Atlas successfully.');

      // Auto-migrate local JSON data to MongoDB if database is empty
      const prodCount = await ProductModel.countDocuments();
      if (prodCount === 0) {
        const localProducts = readJSONFile(PRODUCTS_FILE);
        if (localProducts.length > 0) {
          await ProductModel.insertMany(localProducts);
          console.log(`📦 Seeded ${localProducts.length} products from JSON to MongoDB Atlas.`);
        }
      }

      const userCount = await UserModel.countDocuments();
      if (userCount === 0) {
        const localUsers = readJSONFile(USERS_FILE);
        if (localUsers.length > 0) {
          await UserModel.insertMany(localUsers);
          console.log(`👤 Seeded ${localUsers.length} users from JSON to MongoDB Atlas.`);
        }
      }
    } catch (err) {
      console.error('❌ MongoDB Connection Error:', err.message);
      console.log('⚠️ Falling back to local JSON file database.');
    }
  } else {
    console.log('ℹ️ MONGODB_URI not set. Running with local JSON database.');
  }
}

connectDB();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(__dirname));

// ====================================================
// PRODUCTS API ENDPOINTS
// ====================================================
app.get('/api/products', async (req, res) => {
  if (isMongoConnected) {
    try {
      const products = await ProductModel.find({}, { _id: 0, __v: 0 }).lean();
      return res.json(products);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch products' });
    }
  } else {
    const products = readJSONFile(PRODUCTS_FILE);
    res.json(products);
  }
});

app.post('/api/products', async (req, res) => {
  const { name, price, gender, category, description, images, sizes } = req.body;
  if (!name || isNaN(price) || !sizes || typeof sizes !== 'object') {
    return res.status(400).json({ error: 'Missing or invalid fields' });
  }

  const stock = Object.values(sizes).reduce((sum, val) => sum + (parseInt(val) || 0), 0);
  const newProduct = {
    id: 'prod_' + Date.now(),
    name,
    price: parseFloat(price),
    gender,
    category,
    description: description || '',
    images: images || [],
    sizes: sizes,
    stock: stock,
    reviews: [],
    createdAt: new Date().toISOString()
  };

  if (isMongoConnected) {
    try {
      await ProductModel.create(newProduct);
      return res.status(201).json(newProduct);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to save product to database' });
    }
  } else {
    const products = readJSONFile(PRODUCTS_FILE);
    products.push(newProduct);
    writeJSONFile(PRODUCTS_FILE, products);
    res.status(201).json(newProduct);
  }
});

app.post('/api/products/:id/reviews', async (req, res) => {
  const productId = req.params.id;
  const { username, rating, comment } = req.body;

  if (!username || isNaN(rating) || !comment) {
    return res.status(400).json({ error: 'Missing required review fields' });
  }

  const newReview = {
    id: 'rev_' + Date.now(),
    username,
    rating: Math.min(5, Math.max(1, parseInt(rating) || 5)),
    comment: comment.trim(),
    createdAt: new Date().toISOString()
  };

  if (isMongoConnected) {
    try {
      const product = await ProductModel.findOne({ id: productId });
      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }
      product.reviews.push(newReview);
      await product.save();
      const plainProduct = product.toObject();
      delete plainProduct._id;
      delete plainProduct.__v;
      return res.status(201).json(plainProduct);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to add review' });
    }
  } else {
    const products = readJSONFile(PRODUCTS_FILE);
    const index = products.findIndex(p => p.id === productId);

    if (index === -1) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (!products[index].reviews) {
      products[index].reviews = [];
    }

    products[index].reviews.push(newReview);
    writeJSONFile(PRODUCTS_FILE, products);
    res.status(201).json(products[index]);
  }
});

app.put('/api/products/:id/stock', async (req, res) => {
  const productId = req.params.id;
  const { sizes } = req.body;
  
  if (!sizes || typeof sizes !== 'object') {
    return res.status(400).json({ error: 'Invalid sizes object' });
  }

  const stock = Object.values(sizes).reduce((sum, val) => sum + (parseInt(val) || 0), 0);

  if (isMongoConnected) {
    try {
      const product = await ProductModel.findOneAndUpdate(
        { id: productId },
        { sizes, stock },
        { new: true, projection: { _id: 0, __v: 0 } }
      ).lean();

      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }
      return res.json(product);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to update stock' });
    }
  } else {
    const products = readJSONFile(PRODUCTS_FILE);
    const index = products.findIndex(p => p.id === productId);
    
    if (index === -1) {
      return res.status(404).json({ error: 'Product not found' });
    }

    products[index].sizes = sizes;
    products[index].stock = stock;
    
    writeJSONFile(PRODUCTS_FILE, products);
    res.json(products[index]);
  }
});

app.delete('/api/products/:id', async (req, res) => {
  const productId = req.params.id;

  if (isMongoConnected) {
    try {
      const result = await ProductModel.deleteOne({ id: productId });
      if (result.deletedCount === 0) {
        return res.status(404).json({ error: 'Product not found' });
      }
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to delete product' });
    }
  } else {
    let products = readJSONFile(PRODUCTS_FILE);
    const initialLength = products.length;
    products = products.filter(p => p.id !== productId);
    
    if (products.length === initialLength) {
      return res.status(404).json({ error: 'Product not found' });
    }

    writeJSONFile(PRODUCTS_FILE, products);
    res.json({ success: true });
  }
});

// ====================================================
// AUTHENTICATION API ENDPOINTS
// ====================================================
app.post('/api/signup', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  if (username.toLowerCase() === 'yagnasrinivas26@gmail.com') {
    return res.status(400).json({ error: 'This email is reserved for administration.' });
  }

  if (isMongoConnected) {
    try {
      const existingUser = await UserModel.findOne({
        username: { $regex: new RegExp('^' + username + '$', 'i') }
      });
      if (existingUser) {
        return res.status(400).json({ error: 'Username/Email is already taken' });
      }
      const newUser = {
        id: 'user_' + Date.now(),
        username: username,
        password: password
      };
      await UserModel.create(newUser);
      return res.status(201).json({ id: newUser.id, username: newUser.username });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to register user' });
    }
  } else {
    const users = readJSONFile(USERS_FILE);
    const existingUser = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    
    if (existingUser) {
      return res.status(400).json({ error: 'Username/Email is already taken' });
    }

    const newUser = {
      id: 'user_' + Date.now(),
      username: username,
      password: password
    };

    users.push(newUser);
    writeJSONFile(USERS_FILE, users);
    res.status(201).json({ id: newUser.id, username: newUser.username });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  // Check admin credentials
  if (username.toLowerCase() === 'yagnasrinivas26@gmail.com' && password === 'Yagna@2006') {
    return res.json({ id: 'admin_vyora', username: 'yagnasrinivas26@gmail.com', isAdmin: true });
  }

  if (isMongoConnected) {
    try {
      const user = await UserModel.findOne({
        username: { $regex: new RegExp('^' + username + '$', 'i') },
        password: password
      });
      if (!user) {
        return res.status(401).json({ error: 'Invalid username/email or password' });
      }
      return res.json({ id: user.id, username: user.username, isAdmin: false });
    } catch (err) {
      return res.status(500).json({ error: 'Authentication failed' });
    }
  } else {
    const users = readJSONFile(USERS_FILE);
    const user = users.find(
      u => u.username.toLowerCase() === username.toLowerCase() && u.password === password
    );

    if (!user) {
      return res.status(401).json({ error: 'Invalid username/email or password' });
    }

    res.json({ id: user.id, username: user.username, isAdmin: false });
  }
});

// ====================================================
// CHECKOUT API ENDPOINT
// ====================================================
app.post('/api/checkout', async (req, res) => {
  const { cart } = req.body; // Cart structure: { "productId::size": quantity }
  
  if (!cart || typeof cart !== 'object') {
    return res.status(400).json({ error: 'Invalid cart details' });
  }

  if (isMongoConnected) {
    try {
      const products = await ProductModel.find().lean();
      
      // Validate stock levels
      for (const [cartKey, qty] of Object.entries(cart)) {
        const [prodId, size] = cartKey.split('::');
        if (!prodId || !size) {
          return res.status(400).json({ error: 'Invalid cart structure' });
        }

        const product = products.find(p => p.id === prodId);
        if (!product) {
          return res.status(400).json({ error: `Product not found: ${prodId}` });
        }
        
        const availableStock = parseInt(product.sizes?.[size]) || 0;
        if (availableStock < qty) {
          return res.status(400).json({ 
            error: `Not enough stock for "${product.name}" in Size ${size}. Only ${availableStock} items remaining.` 
          });
        }
      }

      // Deduct stock levels
      for (const [cartKey, qty] of Object.entries(cart)) {
        const [prodId, size] = cartKey.split('::');
        const product = await ProductModel.findOne({ id: prodId });
        if (product) {
          const currentSizeStock = parseInt(product.sizes[size]) || 0;
          const newSizeStock = Math.max(0, currentSizeStock - qty);
          
          product.sizes = { ...product.sizes, [size]: newSizeStock };
          product.markModified('sizes');
          product.stock = Object.values(product.sizes).reduce((sum, val) => sum + (parseInt(val) || 0), 0);
          await product.save();
        }
      }

      return res.json({ success: true });
    } catch (err) {
      console.error('Checkout error:', err);
      return res.status(500).json({ error: 'Checkout failed due to database error' });
    }
  } else {
    const products = readJSONFile(PRODUCTS_FILE);
    let updatedProducts = [...products];

    // Validate stock levels
    for (const [cartKey, qty] of Object.entries(cart)) {
      const [prodId, size] = cartKey.split('::');
      if (!prodId || !size) {
        return res.status(400).json({ error: 'Invalid cart structure' });
      }

      const product = updatedProducts.find(p => p.id === prodId);
      if (!product) {
        return res.status(400).json({ error: `Product not found: ${prodId}` });
      }
      
      const availableStock = parseInt(product.sizes[size]) || 0;
      if (availableStock < qty) {
        return res.status(400).json({ 
          error: `Not enough stock for "${product.name}" in Size ${size}. Only ${availableStock} items remaining.` 
        });
      }
    }

    // Deduct stock levels
    for (const [cartKey, qty] of Object.entries(cart)) {
      const [prodId, size] = cartKey.split('::');
      const index = updatedProducts.findIndex(p => p.id === prodId);
      if (index !== -1) {
        updatedProducts[index].sizes[size] = (parseInt(updatedProducts[index].sizes[size]) || 0) - qty;
        updatedProducts[index].stock = Object.values(updatedProducts[index].sizes).reduce(
          (sum, val) => sum + (parseInt(val) || 0), 0
        );
      }
    }

    writeJSONFile(PRODUCTS_FILE, updatedProducts);
    res.json({ success: true });
  }
});

// Serve storefront pages
app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'index.html'));
  } else {
    next();
  }
});

app.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`  VYORA Server running on port ${PORT}`);
  console.log(`  Database Mode: ${MONGODB_URI ? 'MongoDB Atlas' : 'Local JSON File Backup'}`);
  console.log(`  Open your browser at: http://localhost:${PORT}`);
  console.log(`==================================================\n`);
});
