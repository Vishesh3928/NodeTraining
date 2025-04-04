//this file will include apis for full registeration process and verifications 

import pool, {
    hash,
    genTokenForVerification,
  } from "../config/db.js";
import joi from "joi";
import nativeQueries from "../nativequeries/nativeQueries.json" assert { type: "json" };
import errorMessages from "../config/errorMessages.json" assert { type: "json" };
import successMessages from "../config/successMessages.json" assert { type: "json" };
import { ApiError } from "../utils/ApiError.js";
import logger from "../logger/index.js";
import ApiResponse from "../utils/ApiResponse.js";
import { registerNewUser, verifyUser , updateToken, insertIntoOtp, updateInOtp, verifyUserNumber } from "../handler/registerHandler.js";
import { NEXT_ACTIONS } from "../config/appConstants.js";
import cloudinary from "../config/cloudinaryConfig.js";
// const emailSchema = joi.object({
//     name: joi.string().min(3).required(),
//     email: joi.string().email().required(),
//     password: joi.string().min(6).required(),
//     phoneNumber: joi.string().required(),
//     verificationMethod: joi.string().required(),
//   });

const emailSchema = joi.object({
  email: joi.string().email().required(),
});
const passwordSchmea = joi.object({
    password:joi.string().min(6).required(),
    unique_id:joi.string().required(),
})
const phoneSchema = joi.object({
    number: joi.string().min(12).required(),
    unique_id:joi.string().required(),
    otp: joi.string().length(4).pattern(/^\d+$/)
});

const mergedSchema = passwordSchmea.concat(emailSchema);

const nameSchema = joi.object({
    username: joi.string().min(3).pattern(/^[a-zA-Z0-9_@]+$/).message({'string.pattern.base': 'Username can only contain letters, numbers, _ and @',}).required(),
    firstname: joi.string().pattern(/^[a-zA-Z0-9_@]+$/).min(3).required(),
    lastname: joi.string().pattern(/^[a-zA-Z0-9_@]+$/).required(),
    email: joi.string().email().required()
});

export const registerEmail = async(req,res , next)=>{
    const {error} = emailSchema.validate(req.body);
    if(error){
        logger.warn({ message: "Validation error during registration", validationError: error.message });
        return next(new ApiError(400, errorMessages.validationError, [error.message]));
    }

    const {email} = req.body;

    try {
        //check if user is present in db 
        const [existingUser] = await pool.query(nativeQueries.getUser, [email,null,null]);
        const user =  existingUser[0];
        if(existingUser.length > 0){ 
            //check if "register_complete is false or true"
            if(user.register_complete == 1){
                //if true
                logger.warn({ message: "Registration failed: User already exists", email });
                return next(new ApiError(409 ,errorMessages.userExists ,[{id:user.unique_id}]))
            }else if (user.register_complete == 0){
                //if registeration is incomplete return next_action to frontend
                if(user.next_action == NEXT_ACTIONS.EMAIL_VERIFICATION){
                    const connection = await pool.getConnection();
                    const token = await genTokenForVerification(user.email)
                    res.locals.registerData = updateToken(user.user_id, token, user.email, connection)
                    next();
                }
                res.locals.registerData = new ApiResponse (200, true ,"User exists Check for next_action" , [{next_action:user.next_action , user: {email:email,id:user.unique_id}} ]);
                next()
            }
        }else{
            //enter email into the users table , set next_action to "EMAIL_VERIFICATION"
            const connection = await pool.getConnection();
            res.locals.registerData = await registerNewUser(email , connection);
            return next();
        }
    } catch (error) {
        console.error(error);
        return next()
    }
}

export async function emailVerification(req,res,next){
    // const {email} = req.body;
    const{error} = mergedSchema.validate(req.body);
    if(error){
        logger.warn({ message: "Validation error during registration", validationError: error.message });
        return next(new ApiError(400, errorMessages.validationError, [error.message]));
    }

    const{email ,unique_id , password} = req.body;
    //get info on expiry dates
    const[result] = await pool.query(nativeQueries.getFromVerification , [unique_id]);
    console.log(result);
    const user =result[0];
    console.log(new Date(Date.now()));

    if(result.length > 0){
        if(user.isVerified == 1){
            //if it was verified this shouldnt be called 
            // get the nextAction from the users table to redirect the user to valid step
            const [action] = await pool.query(nativeQueries.getUser,[email , null]);
            return next(new ApiError(409,"this email already exists", [{next_action : action[0].next_action,email:email}]))
        }else if(
            user.isVerified == 0 &&
            new Date(user.expires_at) > new Date(Date.now())
        ){

            res.locals.registerData = new ApiResponse(200 , successMessages.emailVerified, [{next_action:NEXT_ACTIONS.SET_PASSWORD, email:email} ])
            const connection = await pool.getConnection();
            //hash the password 
            const hashedPassword = await hash(password);
            res.locals.registerData = await verifyUser(user.user_id ,email , hashedPassword, connection );
            next();
        }else if(
        user.isVerified == false &&
        new Date(user.expires_at) < new Date(Date.now())
        ){
            const token = await genTokenForVerification(email);
            const connection = await pool.getConnection();
            res.locals.registerData = updateToken(user.user_id, token, email, connection)
        }
    }else{
        return res.status(400).json({messsage:"invalid token"})
    }
        
}

export async function storePassword(req,res,next){
    const{error} = mergedSchema.validate(req.body);
    if(error){
        logger.warn({ message: "Validation error during registration", validationError: error.message });
        return next(new ApiError(400, errorMessages.validationError, [error.message]));
    }

    const{password , unique_id , email} = req.body;
    if(!unique_id){
        return next(new ApiError(404,"id is needed for this operation"));
    }
    console.log(unique_id)
    try{
        const hashedPassword = await hash(password);
        await pool.query(nativeQueries.insertPassword , [hashedPassword , NEXT_ACTIONS.PHONE_VERIFICATION, String(unique_id)]);
        // res.locals.registerData = new ApiResponse(200 , true , "Password Stored");
        next();
    }catch(error){
        return next(new ApiError(500 , "Internal server error" ,[error]))
    }
} 

export async function sendOtp(req,res,next){
    const {error} = phoneSchema.validate(req.body);
    const connection = await pool.getConnection();

    if(error){
        logger.warn({ message: "Validation error during registration", validationError: error.message });
        return next(new ApiError(400, errorMessages.validationError, [error.message]));
    }

    const{number , unique_id} = req.body

    try{
        let digits = "0123456789";
        let OTP = "";
    
        for (let index = 0; index < 4; index++) {
          OTP += digits[Math.floor(Math.random() * 10)];
        }
        const[result] = await connection.query(nativeQueries.getOtpVerificationStatus,[unique_id])
        const user = result[0];
        if(result.length > 0){
            //check if verified
            if(user.isVerified == 1){
                //if it was verified this shouldnt be called 
            // get the nextAction from the users table to redirect the user to valid step
            const [action] = await pool.query(nativeQueries.getUser,[null, unique_id]);
            return next(new ApiError(409,"this number already exists", [{next_action : action[0].next_action,phone_number:action[0].phone_number}]))

            }else if(user.isVerified ==0){
                console.log(OTP)
                //if status is not verified , update otp
                res.locals.registerData = await updateInOtp(unique_id, OTP , number ,connection, next);
                next()
            }
        }else{
            console.log(OTP)
            //if the user is not in otp_verifications insert in the table
            res.locals.registerData = await insertIntoOtp(unique_id,number , OTP, connection , next);
            next()
        }
    }catch(error){
        console.log(error)
        return next(new ApiError(500 , "Internal server error" ,[error]))
    }

}

export async function verifyOtp(req,res,next) {
    const connection = await pool.getConnection();
    const {error} = phoneSchema.validate(req.body);
    if(error){
        logger.warn({ message: "Validation error during registration", validationError: error.message });
        return next(new ApiError(400, errorMessages.validationError, [error.message]));
    }
    //
    const {number , otp , unique_id} = req.body;

    if(!otp){
        return next(new ApiError(400 , errorMessages.validationError + "need otp"));
    }

    //search user 
    const [existingUser] = await connection.query(nativeQueries.getUser , [null , unique_id]);
    const user = existingUser[0];
    if(existingUser.length>0){
        if(user.register_complete == 1){
            return next(new ApiError(409 , errorMessages.userExists ));
        }
        if(user.next_action != NEXT_ACTIONS.PHONE_VERIFICATION){
            return next(new ApiError(400 ,"User please verify email and set password first before trying to verify phone_number",[{next_action : user.next_action}] ));
        }
        const[expiry] = await connection.query(nativeQueries.getOtpExpiry,[unique_id]);
        const expires_at = expiry[0].expires_at;
        const OTP = expiry[0].otp;
        if(new Date(expires_at)<new Date(Date.now())){
            return next(new ApiError(401 , errorMessages.expiredOtp));
        }
        if(otp != OTP){
            return next(new ApiError(401 , errorMessages.wrongOTP));
        }
        //verify otp
        res.locals.registerData = await verifyUserNumber(unique_id , number  , connection , next);
        next();

    }else{
        return next(new ApiError(409 , "User registration not complete. Cannot proceed with phone verification."));
    }
}

export async function createProfile(req,res,next){
    const {error} = nameSchema.validate(req.body);
    if(error){
        logger.warn({ message: "Validation error during registration", validationError: error.message });
        return next(new ApiError(400, errorMessages.validationError, [error.message]));
    }
    const {username , firstname , lastname, email} = req.body;

    try {
        const [existingUser] = await pool.query(nativeQueries.getUser,[null,null,username]);
        if(existingUser.length >0){
            return next(new ApiError(409 , errorMessages.nameExists));
        }
        const [result]= await pool.query(nativeQueries.insertName ,[username , firstname , lastname, NEXT_ACTIONS.UPLOAD_PROFILE_PHOTO, email])
        console.log(result);
        if(result.affectedRows== 0){
            return next(new ApiResponse(404) , "user not found");
        }
        res.locals.registerData =new ApiResponse(200 , successMessages.profileCreated);
        next();
    } catch (error) {
        console.error(error);
        return next(new ApiError(500 , errorMessages.internalServerError));
    }
}

export async function uploadProfilePhoto(req,res,next) {
            try {
              if (!req.files || !req.files.profilePhoto) {
                return res.status(400).json({ message: 'No file uploaded' });
              }
              const {email} = req.body
              if(!email){
                return next(new ApiError ((400) ,errorMessages.validationError ))
              }
              const file = req.files.profilePhoto;
          
              const result = await cloudinary.uploader.upload(file.tempFilePath, {
                folder: 'profile_photos',
              });
              
              const imageUrl = result.secure_url;
              
              const [updateResult] = await pool.query(nativeQueries.updateProfileImage , [imageUrl,NEXT_ACTIONS.NONE,email]);
              console.log(result)
              res.status(200).json({
                message: 'Profile photo uploaded successfully',
                imageUrl,
              });
            } catch (err) {
              console.error(err);
              return res.status(500).json({ message: 'Upload failed', error: err.message });
            }
          }
    


