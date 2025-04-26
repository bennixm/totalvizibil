import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Route test
app.get('/', (req, res) => {
  res.send('API is working ✅');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
