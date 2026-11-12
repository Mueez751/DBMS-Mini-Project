require('dotenv').config();
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/airfare';
let client = null;
let db = null;

async function connectMongo() {
  if (db) return db;
  try {
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 4000 });
    await client.connect();
    db = client.db('airfare');
    console.log('✓ Connected to MongoDB');
    return db;
  } catch (err) {
    console.warn('MongoDB connection failed (optional features will be simulated or limited):', err.message);
    return null;
  }
}

function getMongoDb() {
  return db;
}

module.exports = {
  connectMongo,
  getMongoDb,
};

