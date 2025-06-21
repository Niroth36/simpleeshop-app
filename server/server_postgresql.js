const express = require('express');
const { Pool } = require('pg'); // PostgreSQL driver
const cors = require('cors');
const path = require('path');

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const session = require('express-session');
const Minio = require('minio'); // MinIO client
const nodemailer = require('nodemailer'); // For sending emails

const app = express();
const port = process.env.PORT || 3000;

const SECRET_KEY = process.env.SECRET_KEY || 'mYA3eyYD0R-dI420-81COf7';

// Function to send welcome email directly from the application
async function sendWelcomeEmail(username, email) {
    try {
        // Configure SMTP transport
        const smtpHost = process.env.SMTP_HOST || 'mailpit';
        const smtpPort = parseInt(process.env.SMTP_PORT || '1025');
        console.log(`Using SMTP server: ${smtpHost}:${smtpPort}`);

        // Create a nodemailer transporter
        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: false, // true for 465, false for other ports
            tls: {
                rejectUnauthorized: false // Accept self-signed certificates
            }
        });

        // Prepare email content
        const mailOptions = {
            from: '"SimpleEshop" <noreply@simpleeshop.com>',
            to: email,
            subject: `Welcome to SimpleEshop, ${username || 'New User'}!`,
            text: `Hello ${username || 'there'},\n\nWelcome to SimpleEshop! We're excited to have you on board.\n\nHappy shopping!\nThe SimpleEshop Team`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2>Welcome to SimpleEshop!</h2>
                    <p>Hello ${username || 'there'},</p>
                    <p>We're excited to have you join our community of tech enthusiasts!</p>
                    <p>With your new account, you can:</p>
                    <ul>
                        <li>Browse our extensive catalog of tech products</li>
                        <li>Save items to your wishlist</li>
                        <li>Track your orders</li>
                        <li>Receive exclusive offers</li>
                    </ul>
                    <p>If you have any questions, feel free to contact our support team.</p>
                    <p>Happy shopping!</p>
                    <p><strong>The SimpleEshop Team</strong></p>
                </div>
            `
        };

        // Send the email
        const info = await transporter.sendMail(mailOptions);
        console.log('Welcome email sent successfully:', info.messageId);
        return true;
    } catch (error) {
        console.error('Error sending welcome email:', error);
        return false;
    }
}

// MinIO client setup
const minioClient = new Minio.Client({
    endPoint: process.env.MINIO_HOST || 'minio',
    port: parseInt(process.env.MINIO_PORT || '9000'),
    useSSL: false,
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin'
});

// Log MinIO connection details for debugging
console.log(`MinIO client configured with: endPoint=${process.env.MINIO_HOST || 'minio'}, port=${parseInt(process.env.MINIO_PORT || '9000')}`);

// Ensure the user-registrations bucket exists
async function ensureMinioUserBucket() {
    try {
        const bucketName = 'user-registrations';
        const bucketExists = await minioClient.bucketExists(bucketName);

        if (!bucketExists) {
            await minioClient.makeBucket(bucketName);
            console.log(`Created MinIO bucket: ${bucketName}`);
        }

        // Try to set up bucket notification for email service, but don't fail if it's not available
        try {
            const config = {
                Events: ['s3:ObjectCreated:*'],
                Filter: {
                    Key: {
                        FilterRules: [
                            {
                                Name: 'suffix',
                                Value: '.json'
                            }
                        ]
                    }
                },
                CloudFunction: 'http://welcome-email:8080',
                Id: 'welcome-email-notification'
            };

            await minioClient.setBucketNotification(bucketName, config);
            console.log(`Set up bucket notification for ${bucketName} to trigger email service`);
        } catch (notificationErr) {
            console.log(`Email service not available or bucket notification setup failed. Using direct email sending instead.`);
            // Clear any existing notifications to avoid errors
            try {
                await minioClient.setBucketNotification(bucketName, {});
                console.log(`Cleared bucket notifications for ${bucketName}`);
            } catch (clearErr) {
                console.log(`Failed to clear bucket notifications: ${clearErr.message}`);
            }
        }
    } catch (err) {
        console.error('Error setting up MinIO bucket:', err);
    }
}

// Ensure the order-confirmations bucket exists
async function ensureMinioOrderBucket() {
    try {
        const bucketName = 'order-confirmations';
        const bucketExists = await minioClient.bucketExists(bucketName);

        if (!bucketExists) {
            await minioClient.makeBucket(bucketName);
            console.log(`Created MinIO bucket: ${bucketName}`);
        }

        // Try to set up bucket notification for email service, but don't fail if it's not available
        try {
            const config = {
                Events: ['s3:ObjectCreated:*'],
                Filter: {
                    Key: {
                        FilterRules: [
                            {
                                Name: 'suffix',
                                Value: '.json'
                            }
                        ]
                    }
                },
                CloudFunction: 'http://order-confirmation-email:8081',
                Id: 'order-confirmation-email-notification'
            };

            await minioClient.setBucketNotification(bucketName, config);
            console.log(`Set up bucket notification for ${bucketName} to trigger email service`);
        } catch (notificationErr) {
            console.log(`Email service not available or bucket notification setup failed. Using direct email sending instead.`);
            // Clear any existing notifications to avoid errors
            try {
                await minioClient.setBucketNotification(bucketName, {});
                console.log(`Cleared bucket notifications for ${bucketName}`);
            } catch (clearErr) {
                console.log(`Failed to clear bucket notifications: ${clearErr.message}`);
            }
        }
    } catch (err) {
        console.error('Error setting up MinIO bucket:', err);
    }
}

// Enable CORS for client-side requests
app.use(cors());

// Serve static files from the 'public' folder
app.use(express.static(path.join(__dirname, '../public')));

app.use(bodyParser.json());

// Redis client setup for sessions (conditional)
let sessionStore;
try {
    if (process.env.NODE_ENV === 'production' && process.env.REDIS_HOST) {
        const { createClient } = require('redis');
        const RedisStore = require('connect-redis').default;

        const redisClient = createClient({
            socket: {
                host: process.env.REDIS_HOST || 'localhost',
                port: process.env.REDIS_PORT || 6379
            }
        });

        redisClient.connect().catch(console.error);
        sessionStore = new RedisStore({ client: redisClient });
        console.log('Using Redis for session storage');
    } else {
        console.log('Using MemoryStore for session storage (development only)');
    }
} catch (error) {
    console.log('Redis not available, using MemoryStore for session storage');
}

app.use(session({
    store: sessionStore,
    secret: SECRET_KEY,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true if using HTTPS
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 // 24 hours
    }
}));

// PostgreSQL connection pool with environment variables for Docker
const pool = new Pool({
    user: process.env.DB_USER || 'techhub',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'techgearhub',
    password: process.env.DB_PASSWORD || '!@#123Abc',
    port: process.env.DB_PORT || 5432,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// Database connection with retry logic
async function connectWithRetry() {
    const maxRetries = 5;
    let retries = 0;

    while (retries < maxRetries) {
        try {
            const client = await pool.connect();
            console.log('Connected to PostgreSQL!');
            client.release();
            return;
        } catch (err) {
            retries++;
            console.log(`Database connection attempt ${retries}/${maxRetries} failed. Retrying in 5 seconds...`);
            console.error('Connection error:', err.message);

            if (retries === maxRetries) {
                console.error('Max retries reached. Could not connect to database.');
                process.exit(1);
            }

            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

// Initialize database connection
connectWithRetry();

// Initialize MinIO buckets
ensureMinioUserBucket();
ensureMinioOrderBucket();

// User registration
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !password) {
        return res.status(400).send('Username and password are required');
    }

    try {
        const hash = await bcrypt.hash(password, 10);
        const query = 'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id';
        const result = await pool.query(query, [username, email, hash]);
        const userId = result.rows[0].id;

        // Store user data in MinIO for triggering welcome email
        try {
            const userDataJson = JSON.stringify({
                userId: userId,
                username: username,
                email: email,
                registrationDate: new Date().toISOString()
            });

            const bucketName = 'user-registrations';
            const objectName = `user-${userId}-${Date.now()}.json`;

            await minioClient.putObject(bucketName, objectName, userDataJson);
            console.log(`User data stored in MinIO: ${objectName}`);

            // Log that we would send a welcome email
            await sendWelcomeEmail(username, email);
        } catch (minioErr) {
            console.error('Error storing user data in MinIO:', minioErr);
            // Continue with registration even if MinIO storage fails
        }

        res.status(201).send('User registered successfully');
    } catch (err) {
        console.error(err);
        if (err.code === '23505') { // PostgreSQL unique violation error code
            return res.status(400).send('Username or email already exists');
        }
        res.status(500).send('Server error');
    }
});

// User login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const query = 'SELECT * FROM users WHERE username = $1';
        const result = await pool.query(query, [username]);

        if (result.rows.length === 0) {
            return res.status(401).send('Invalid username or password');
        }

        const user = result.rows[0];
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(401).send('Invalid username or password');
        }

        req.session.userId = user.id;
        res.status(200).send('Login successful');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// Endpoint to get the logged-in user's info
app.get('/api/user', async (req, res) => {
    if (req.session.userId) {
        try {
            const query = 'SELECT username FROM users WHERE id = $1';
            const result = await pool.query(query, [req.session.userId]);

            if (result.rows.length > 0) {
                res.json({ username: result.rows[0].username });
            } else {
                res.status(404).send('User not found');
            }
        } catch (err) {
            console.error(err);
            res.status(500).send('Server error');
        }
    } else {
        res.status(401).send('Not authenticated');
    }
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error(err);
            res.status(500).send('Server error');
        } else {
            res.status(200).send('Logged out successfully');
        }
    });
});

// Check authentication
function isAuthenticated(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.status(401).send('You need to log in first');
    }
}

// Endpoint to fetch products by category
app.get('/api/products', async (req, res) => {
    const category = req.query.category;

    try {
        const query = category
            ? 'SELECT * FROM products WHERE category = $1'
            : 'SELECT * FROM products';

        const result = await pool.query(query, category ? [category] : []);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

app.get('/cart', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/cart.html'));
});

app.get('/checkout', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/checkout.html'));
});

// Checkout endpoint
app.post('/api/checkout', async (req, res) => {
    const userId = req.session.userId;

    if (!userId) {
        return res.status(401).json({ message: 'User not authenticated' });
    }

    // Extract payment information from request body
    const { iban, cvc, expiry, owner } = req.body;

    // Validate payment information
    if (!iban || !cvc || !expiry || !owner) {
        return res.status(400).json({ message: 'Payment information is required' });
    }

    try {
        const fetchCartQuery = 'SELECT cart_id, products FROM carts WHERE user_id = $1 LIMIT 1';
        const cartResult = await pool.query(fetchCartQuery, [userId]);

        if (cartResult.rows.length === 0) {
            return res.status(400).json({ message: 'Cart is empty' });
        }

        const { cart_id, products } = cartResult.rows[0];
        let productList;

        try {
            // PostgreSQL JSONB is already parsed, no need for JSON.parse()
            productList = products || [];
            // Ensure it's an array
            if (!Array.isArray(productList)) {
                productList = [];
            }
        } catch (parseError) {
            console.error('Error handling products data:', parseError);
            return res.status(500).json({ message: 'Server error' });
        }

        if (productList.length === 0) {
            return res.status(400).json({ message: 'Cart is empty' });
        }

        // Calculate total amount
        const totalAmount = parseFloat(
            productList.reduce((sum, item) => sum + item.value * item.quantity, 0).toFixed(2)
        );

        // Insert into orders table
        const insertOrderQuery = `
            INSERT INTO orders (user_id, cart_id, total_amount) 
            VALUES ($1, $2, $3)
        `;

        const orderResult = await pool.query(insertOrderQuery, [userId, cart_id, totalAmount]);

        // Get user information for the order confirmation email
        const userQuery = 'SELECT username, email FROM users WHERE id = $1';
        const userResult = await pool.query(userQuery, [userId]);

        if (userResult.rows.length === 0) {
            console.error(`User with ID ${userId} not found`);
            res.status(200).json({ message: 'Order placed successfully, but confirmation email could not be sent' });
            return;
        }

        const { username, email } = userResult.rows[0];

        // Store order data in MinIO for triggering order confirmation email
        try {
            // Generate a unique order ID
            const orderId = `ORD-${userId}-${Date.now()}`;

            // Create order data JSON
            const orderDataJson = JSON.stringify({
                orderData: {
                    orderId: orderId,
                    userId: userId,
                    username: username,
                    email: email,
                    items: productList.map(item => ({
                        id: item.product_id,
                        name: item.title || item.name,
                        price: item.value || item.price,
                        quantity: item.quantity
                    })),
                    total: totalAmount,
                    orderDate: new Date().toISOString()
                }
            });

            const bucketName = 'order-confirmations';
            const objectName = `order-${orderId}-${Date.now()}.json`;

            await minioClient.putObject(bucketName, objectName, orderDataJson);
            console.log(`Order data stored in MinIO: ${objectName}`);
        } catch (minioErr) {
            console.error('Error storing order data in MinIO:', minioErr);
            // Continue with checkout even if MinIO storage fails
        }

        // Clear the cart after successful checkout
        try {
            const deleteCartQuery = 'DELETE FROM carts WHERE user_id = $1';
            await pool.query(deleteCartQuery, [userId]);
            console.log(`[Checkout] Cart cleared for user: ${userId} after successful order`);
        } catch (clearErr) {
            console.error('[Checkout] Error clearing cart after checkout:', clearErr);
            // Continue even if cart clearing fails
        }

        console.log(`[Checkout] Order created successfully for user: ${userId}`);
        res.status(200).json({ message: 'Order placed successfully' });
    } catch (err) {
        console.error('Error during checkout:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get all orders
app.get('/api/orders', async (req, res) => {
    try {
        const fetchOrdersQuery = `
            SELECT o.*, c.products 
            FROM orders o 
            LEFT JOIN carts c ON o.cart_id = c.cart_id
        `;

        const result = await pool.query(fetchOrdersQuery);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching orders:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Fetch cart items for the logged-in user
app.get('/api/cart', async (req, res) => {
    const userId = req.session.userId;

    if (!userId) {
        return res.status(401).json({ message: 'User not authenticated' });
    }

    try {
        const fetchCartQuery = 'SELECT products FROM carts WHERE user_id = $1';
        const cartResult = await pool.query(fetchCartQuery, [userId]);

        if (cartResult.rows.length === 0 || !cartResult.rows[0].products) {
            return res.json([]); // Return an empty array if the cart is empty
        }

        let products;
        try {
            // PostgreSQL JSONB is already parsed, no need for JSON.parse()
            products = cartResult.rows[0].products || [];

            // Ensure it's an array
            if (!Array.isArray(products)) {
                products = [];
            }
        } catch (parseError) {
            console.error('Error handling products data:', parseError);
            return res.status(500).json({ message: 'Server error' });
        }

        if (products.length === 0) {
            return res.json([]); // Return an empty array if no products in cart
        }

        const productIds = products.map(p => p.product_id);

        // Use ANY() for PostgreSQL array comparison
        const fetchProductsQuery = `
            SELECT id AS product_id, title, value AS price 
            FROM products 
            WHERE id = ANY($1)
        `;

        const productResult = await pool.query(fetchProductsQuery, [productIds]);

        const detailedCart = products.map(item => {
            const product = productResult.rows.find(p => p.product_id === item.product_id);
            const cartItem = {
                product_id: item.product_id,
                title: product ? product.title : 'Unknown',
                price: product ? parseFloat(product.price) : 0, // Ensure price is a number
                quantity: item.quantity,
            };
            return cartItem;
        });

        res.json(detailedCart);
    } catch (err) {
        console.error('Error fetching cart:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Clear the entire cart for the logged-in user
app.delete('/api/cart/clear', async (req, res) => {
    const userId = req.session.userId;

    if (!userId) {
        return res.status(401).json({ message: 'User not authenticated' });
    }

    try {
        const deleteCartQuery = 'DELETE FROM carts WHERE user_id = $1';
        await pool.query(deleteCartQuery, [userId]);

        console.log(`[Clear Cart] Cart cleared for user: ${userId}`);
        res.status(200).json({ message: 'Cart cleared successfully' });
    } catch (err) {
        console.error('[Clear Cart] Error clearing cart:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Remove specific product from cart
app.delete('/api/cart/:productId', async (req, res) => {
    const productId = parseInt(req.params.productId, 10);
    const userId = req.session.userId;

    if (!userId) {
        return res.status(401).send('User not authenticated');
    }

    try {
        const fetchCartQuery = 'SELECT cart_id, products FROM carts WHERE user_id = $1 LIMIT 1';
        const cartResult = await pool.query(fetchCartQuery, [userId]);

        if (cartResult.rows.length === 0) {
            return res.status(404).send('Cart not found');
        }

        let { cart_id, products } = cartResult.rows[0];
        try {
            // PostgreSQL JSONB is already parsed, no need for JSON.parse()
            products = products || [];
            // Ensure it's an array
            if (!Array.isArray(products)) {
                products = [];
            }
        } catch (parseError) {
            console.error('Error handling products data:', parseError);
            return res.status(500).send('Server error');
        }

        // Filter out the product to be removed
        const updatedProducts = products.filter(p => p.product_id !== productId);

        if (updatedProducts.length === 0) {
            // Delete the entire cart row if no products remain
            const deleteCartQuery = 'DELETE FROM carts WHERE cart_id = $1';
            await pool.query(deleteCartQuery, [cart_id]);
            res.status(200).send('Cart deleted as it became empty');
        } else {
            // Update the cart with the remaining products
            const updateCartQuery = 'UPDATE carts SET products = $1 WHERE cart_id = $2';
            await pool.query(updateCartQuery, [JSON.stringify(updatedProducts), cart_id]);
            res.status(200).send('Product removed from cart');
        }
    } catch (err) {
        console.error('Error removing product from cart:', err);
        res.status(500).send('Server error');
    }
});

// Update product quantity in cart
app.patch('/api/cart/:productId/quantity', async (req, res) => {
    const productId = parseInt(req.params.productId, 10);
    const userId = req.session.userId;
    const { delta } = req.body;

    if (!userId) {
        return res.status(401).send('User not authenticated');
    }

    try {
        const fetchCartQuery = 'SELECT products FROM carts WHERE user_id = $1';
        const cartResult = await pool.query(fetchCartQuery, [userId]);

        if (cartResult.rows.length === 0) {
            return res.status(404).send('Cart not found');
        }

        let products = [];
        try {
            // PostgreSQL JSONB is already parsed, no need for JSON.parse()
            products = cartResult.rows[0].products || [];
            // Ensure it's an array
            if (!Array.isArray(products)) {
                products = [];
            }
        } catch (parseError) {
            console.error('Error handling products data:', parseError);
            return res.status(500).send('Server error');
        }

        // Find and update the product quantity
        const product = products.find(p => p.product_id === productId);
        if (product) {
            product.quantity = Math.max(product.quantity + delta, 0);
        } else {
            return res.status(404).send('Product not found in cart');
        }

        const updateCartQuery = 'UPDATE carts SET products = $1 WHERE user_id = $2';
        await pool.query(updateCartQuery, [JSON.stringify(products), userId]);

        res.status(200).send('Quantity updated successfully');
    } catch (err) {
        console.error('Error updating cart quantity:', err);
        res.status(500).send('Server error');
    }
});

// Add product to cart
app.post('/api/cart', async (req, res) => {
    const { productId } = req.body;
    const userId = req.session.userId;

    if (!userId) {
        return res.status(401).json({ message: 'User not authenticated' });
    }

    try {
        // Fetch the current cart for the user
        const fetchCartQuery = 'SELECT cart_id, products FROM carts WHERE user_id = $1 LIMIT 1';
        const cartResult = await pool.query(fetchCartQuery, [userId]);

        let cartId = null;
        let products = [];

        if (cartResult.rows.length > 0) {
            cartId = cartResult.rows[0].cart_id;
            try {
                // PostgreSQL JSONB is already parsed, no need for JSON.parse()
                products = cartResult.rows[0].products || [];
                // Ensure it's an array
                if (!Array.isArray(products)) {
                    products = [];
                }
            } catch (parseError) {
                console.error('Error handling products data:', parseError);
                products = [];
            }
        }

        // Fetch product details to include title and value
        const fetchProductQuery = 'SELECT id AS product_id, title, value FROM products WHERE id = $1';
        const productResult = await pool.query(fetchProductQuery, [productId]);

        if (productResult.rows.length === 0) {
            return res.status(404).json({ message: 'Product not found' });
        }

        const product = productResult.rows[0];

        // Check if the product is already in the cart
        const existingProduct = products.find(p => p.product_id === productId);
        if (existingProduct) {
            existingProduct.quantity += 1;
        } else {
            products.push({ ...product, quantity: 1 });
        }

        const updateCartQuery = cartId
            ? 'UPDATE carts SET products = $1 WHERE cart_id = $2'
            : 'INSERT INTO carts (user_id, products) VALUES ($1, $2)';

        const queryParams = cartId
            ? [JSON.stringify(products), cartId]  // Convert to JSON string for storage
            : [userId, JSON.stringify(products)]; // Convert to JSON string for storage

        await pool.query(updateCartQuery, queryParams);

        res.status(200).json({ message: 'Product added to cart' });
    } catch (err) {
        console.error('Error adding product to cart:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Serve category pages dynamically
app.get('/:category', (req, res) => {
    const category = req.params.category;

    // Check if the category matches known categories
    const validCategories = ['cpu', 'ram', 'storage', 'gpu', 'home'];
    if (validCategories.includes(category)) {
        res.sendFile(path.join(__dirname, '../public/EshopPage.html'));
    } else {
        res.status(404).send('Page Not Found');
    }
});

// Serve the home page for the root URL
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/EshopPage.html'));
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${port}`);
});
