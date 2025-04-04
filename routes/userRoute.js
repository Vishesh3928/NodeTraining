import express from 'express'
import { login, register, sendEmail, sendOTP, verifyEmail, verifyOTP } from '../controllers/userController.js'
import {verifyJwt} from '../middleware/authMiddleware.js';
import { createProfile, emailVerification, registerEmail, sendOtp, storePassword, uploadProfilePhoto, verifyOtp } from '../controllers/registerController.js';


const router = express.Router()

router.post('/register', registerEmail);
router.post('/login', login);
router.post('/verifyEmail', emailVerification)
router.post('/sendEmail',verifyJwt,sendEmail);
router.post('/sendOTP',sendOtp);
router.post('/verifyOTP',verifyOtp);
router.post('/setPass',storePassword);
router.post('/createProfile', createProfile);
router.post('/uploadProfile', uploadProfilePhoto);


export default router;