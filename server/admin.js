const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// REPLACE WITH YOUR ACTUAL MONGODB CONNECTION STRING
// (If Atlas gives network errors, you can test locally using: 'mongodb://127.0.0.1:27017/aeturnum')
const MONGO_URI = "mongodb+srv://admin:SecureAdminPassword123@cluster0.mongodb.net/aeturnum?retryWrites=true&w=majority";

const userSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, required: true, default: 'CSR' },
  profilePic: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

async function createAdmin() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB successfully.');

    const adminEmail = 'admin@aeturnum.com';
    const rawPassword = 'SecureAdminPassword123';

    const existingAdmin = await User.findOne({ email: adminEmail });
    if (existingAdmin) {
      console.log('Admin account already exists in database!');
      process.exit(0);
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(rawPassword, salt);

    const newAdmin = new User({
      id: 'AT-ADMIN-01',
      name: 'System Administrator',
      email: adminEmail,
      password: hashedPassword,
      role: 'Admin',
      profilePic: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png'
    });

    await newAdmin.save();
    console.log('✅ Admin account successfully created!');
    process.exit(0);
  } catch (err) {
    console.error('Error creating admin:', err);
    process.exit(1);
  }
}

createAdmin();