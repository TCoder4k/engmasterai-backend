import { Injectable } from "@nestjs/common";
@Injectable({}) //this is dependency injection
export class AuthService {
    register(){
        return {
            message: "Register a new account"
        }
    }
    login(){
        return {
            message: "Login to your account"
        }
    }
}