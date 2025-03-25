import pool from "../config/db.js";
import nativeQueries from "../nativequeries/nativeQueries.json" assert { type: "json" };
import errorMessages from '../config/errorMessages.json' assert {type:'json'}
import {hash, generateRandomString} from '../config/db.js'


export async function findOrCreateUser(profile) {
  try {
    console.log("in find",profile.emails[0].value)
    let result;
     [result] = await pool.query(nativeQueries.getUser, [
      profile.emails[0].value,
    ]);
    // result = result[0]
    let user;
    if (result.length === 0) {
      try{
        const randomPassword = generateRandomString();
        const hashedPassword = await hash(randomPassword);  
        console.log(hashedPassword)
        await pool.query(
          nativeQueries.createUserWithSocial,
          [profile.displayName, profile.emails[0].value,hashedPassword,1]
        );hash("random"); 
        result = await pool.query(nativeQueries.getUser, [
          profile.emails[0].value,
        ]);
      }catch(err){
        console.log(err.message)
      }
    }
    user = result[0];
    console.log("result is:",user)
    return user;
  } catch (err) {
    console.error(errorMessages.GoogleLoginError , err.message);
    throw err;
  }

}




