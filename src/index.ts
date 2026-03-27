// import Apier from "./Apier";
import multipart from 'parse-multipart-data';

export const handler = async (event: any) => {
   try {
      const apier = new Apier(event);

      // 1. Safely parse the body ONLY if it exists
      // const requestBody = event.body ? JSON.parse(event.body) : {};
      let requestBody = {};
      const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'] || '';

      if (event.body && contentType.includes('application/json')) {
         requestBody = JSON.parse(event.body);
      }

      if (apier.method.isOptions) {
         return apier.res.send(null, 200);
      }

      // if (event.requestContext && apier.method.isOptions) {
      //    return apier.res.send();
      // }

      // --- LOGIN ROUTE ---
      if (apier.req.isLogin && apier.method.isPost) {
         await apier.auth.loadSecrets();
         if (!apier.auth.isValidAdmin((requestBody as any).code)) return apier.res.send({ error: "Credenciales inválidas" }, 401);
         const cookieString = apier.auth.generateSessionCookie();
         apier.res.setAuthCookie(cookieString);
         return apier.res.send({ message: "Acceso concedido" }, 200);
      }

      // --- IS AUTHENTICATED ROUTE ---
      if (apier.req.isAuthenticated && apier.method.isGet) {
         await apier.auth.loadSecrets();
         if (apier.auth.sessionIsValid(event)) return apier.res.send({ message: "Authenticated!" }, 200);
         else return apier.res.send({ error: "Unauthorized or session expired" }, 401);
      }

      // --- HEALTH ROUTE ---
      if (apier.req.isHealth) {
         return apier.res.send({ message: "Enabled" });
      }

      // --- USERS ROUTE ---
      if (apier.req.isUsers && apier.method.isGet) {
         return apier.res.send({ message: "This is where your DynamoDB code goes!" });
      }

      // --- PRODUCTS ROUTE ---
      if (apier.req.isProducts && apier.method.isGet) {
         return apier.res.send({
            product_list: [
               { name: "a", price: 1, image_name: "10018.jpg" },
               { name: "b", price: 2, image_name: "10033.jpg" }
            ]
         });
      }

      // --- UPLOAD PRODUCT ROUTE ---
      if (apier.req.isUploadProduct && apier.method.isPost) {
         try {
            // 1. Extract the boundary string from the headers
            const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'] || '';
            const boundary = multipart.getBoundary(contentType);

            if (!boundary) {
               return apier.res.send({ error: "Invalid request: Missing multipart boundary" }, 400);
            }

            // 2. Convert the raw API Gateway event body into a Buffer
            // AWS API Gateway usually Base64-encodes multipart/form-data
            const isBase64 = event.isBase64Encoded;
            const bodyBuffer = Buffer.from(event.body || '', isBase64 ? 'base64' : 'utf8');

            // 3. Parse the data
            const parts = multipart.parse(bodyBuffer, boundary);

            // 4. Organize the extracted parts into fields and files
            const productData: Record<string, string> = {};
            let uploadedImage: any = null;

            parts.forEach(part => {
               if (part.filename) {
                  // It's a file (your product image)
                  uploadedImage = {
                     filename: part.filename,
                     type: part.type,
                     data: part.data // <-- This is the raw Buffer
                  };
               } else if (part.name) {
                  // It's a text field (e.g., product name, price, description)
                  productData[part.name] = part.data.toString('utf8');
               }
            });

            console.log("Extracted Product Data:", productData);
            if (uploadedImage) console.log("Extracted Image:", uploadedImage.filename);

            return apier.res.send({
               message: "Product extracted securely!",
               productDetails: productData,
               hasImage: !!uploadedImage
            }, 200);

         } catch (err: any) {
            console.error("Multipart parsing error:", err);
            return apier.res.send({ error: "Failed to parse form data" }, 500);
         }
      }

      // --- FALLBACK 404 ---
      return apier.res.send({
         error: "Route not found",
         thePathLambdaSaw: event.rawPath
      }, 404);

   } catch (error: any) {
      console.error(error);
      return {
         statusCode: 500,
         headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
            "Content-Type": "application/json"
         },
         body: JSON.stringify({
            error: error.message || "Unknown error occurred",
            thePathLambdaSaw: event.rawPath
         })
      };
   }
};


/////////////////////////////
// Apier
/////////////////////////////

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
   DynamoDBDocumentClient,
   ScanCommand,
   GetCommand,
   PutCommand
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { SSMClient, GetParametersCommand } from "@aws-sdk/client-ssm";

// ---------------------------------------------------------
// GLOBAL INFRASTRUCTURE & CACHE
// Declared outside classes so Lambda reuses them across requests
// ---------------------------------------------------------
const ssmClient = new SSMClient({});
const dbRawClient = new DynamoDBClient({});
const dbDocClient = DynamoDBDocumentClient.from(dbRawClient);

let cachedAdminCode: string | null = null;
let cachedJwtSecret: string | null = null;

// ---------------------------------------------------------
// AUTHENTICATION CLIENT
// ---------------------------------------------------------
class AuthClient {
   public async loadSecrets(): Promise<void> {
      if (cachedAdminCode && cachedJwtSecret) return;

      try {
         const command = new GetParametersCommand({
            Names: [
               "/turquesa.shop/auth/admin-password",
               "/turquesa.shop/auth/jwt-secret"
            ],
            WithDecryption: true
         });

         const response = await ssmClient.send(command);

         response.Parameters?.forEach(param => {
            if (param.Name === "/turquesa.shop/auth/admin-password") {
               cachedAdminCode = param.Value || null;
            }
            if (param.Name === "/turquesa.shop/auth/jwt-secret") {
               cachedJwtSecret = param.Value || null;
            }
         });

      } catch (error) {
         console.error("Failed to load SSM parameters:", error);
         throw new Error("Configuration Error");
      }
   }

   public isValidAdmin(receivedCode: string): boolean {
      return cachedAdminCode === receivedCode;
   }

   // public generateSessionCookie(): string {
   //    if (!cachedJwtSecret) throw new Error("JWT Secret missing from Parameter Store");

   //    const token = jwt.sign({ role: "admin" }, cachedJwtSecret, { expiresIn: "1h" });
   //    return `admin_session=${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=3600; Path=/`;
   // }
   public generateSessionCookie(): string {
      if (!cachedJwtSecret) throw new Error("JWT Secret missing from Parameter Store");
      const token = jwt.sign({ role: "admin" }, cachedJwtSecret, { expiresIn: "1h" });
      // CHANGED: SameSite=Strict -> SameSite=None
      return `admin_session=${token}; HttpOnly; Secure; SameSite=None; Max-Age=3600; Path=/`;
   }

   public sessionIsValid(event: any): boolean {
      if (!cachedJwtSecret) return false;

      try {
         // AWS handles cookies slightly differently depending on API Gateway version
         // This safely checks both Payload v1 (headers) and Payload v2 (cookies array)
         const rawCookieHeader = event.headers?.cookie || event.headers?.Cookie || "";
         const cookiesArray = event.cookies || rawCookieHeader.split(";").map((c: string) => c.trim());

         // Find our specific session cookie
         const sessionCookie = cookiesArray.find((c: string) => c.startsWith("admin_session="));
         if (!sessionCookie) return false;

         // Extract just the token part
         const token = sessionCookie.split("=")[1];

         // Verify the signature and expiration time
         // If it is tampered with or expired, this will throw an error and jump to the catch block
         jwt.verify(token, cachedJwtSecret);

         return true;

      } catch (err) {
         console.error("JWT Verification failed:", err);
         return false;
      }
   }
}

// ---------------------------------------------------------
// API WRAPPER CLASSES
// ---------------------------------------------------------
// class Response {
//    private _headers: Record<string, string> = {
//       "Access-Control-Allow-Origin": "*",
//       "Access-Control-Allow-Headers": "Content-Type",
//       "Content-Type": "application/json"
//    };

//    // Now simply takes the generated string from the AuthClient
//    public setAuthCookie(cookieString: string) {
//       this._headers["Set-Cookie"] = cookieString;
//    }

//    public send(value: any = null, statusCode: number = 200) {
//       return {
//          statusCode: statusCode,
//          headers: this._headers,
//          body: value ? JSON.stringify(value) : ""
//       };
//    }
// }
class Response {
   private _headers: Record<string, string>;

   constructor(event: any) {
      // Safely grab the exact origin making the request
      const origin = event?.headers?.origin || event?.headers?.Origin || "*";

      this._headers = {
         "Access-Control-Allow-Origin": origin,
         "Access-Control-Allow-Credentials": "true", // MUST BE TRUE
         "Access-Control-Allow-Headers": "Content-Type, Authorization", // Added common allowed headers
         "Access-Control-Allow-Methods": "OPTIONS, GET, POST, PUT, DELETE, PATCH", // Explicitly allow methods
         "Content-Type": "application/json"
      };
   }

   public setAuthCookie(cookieString: string) {
      this._headers["Set-Cookie"] = cookieString;
   }

   public send(value: any = null, statusCode: number = 200) {
      return {
         statusCode: statusCode,
         headers: this._headers,
         body: value ? JSON.stringify(value) : ""
      };
   }
}

class Request {
   private _requestRoute: string;
   public isHealth: boolean;
   public isUsers: boolean;
   public isProducts: boolean;
   public isRegister: boolean;
   public isLogin: boolean;
   public isAuthenticated: boolean;
   public isUploadProduct: boolean;

   constructor(event: any) {
      this._requestRoute = event?.rawPath || "";
      this.isHealth = this._requestRoute === "/api/health";
      this.isUsers = this._requestRoute === "/api/users";
      this.isProducts = this._requestRoute === "/api/products";
      this.isRegister = this._requestRoute === "/api/register";
      this.isLogin = this._requestRoute === "/api/login";
      this.isAuthenticated = this._requestRoute === "/api/is-authenticated";
      this.isUploadProduct = this._requestRoute === "/api/upload-product";
   }
}

class Method {
   private _method: string;
   public isOptions: boolean;
   public isGet: boolean;
   public isPost: boolean;
   public isPut: boolean;
   public isPatch: boolean;

   constructor(event: any) {
      this._method = event?.requestContext?.http?.method || "";
      this.isOptions = this._method === "OPTIONS";
      this.isGet = this._method === "GET";
      this.isPost = this._method === "POST";
      this.isPut = this._method === "PUT";
      this.isPatch = this._method === "PATCH";
   }
}

class DbClient {
   private _db: DynamoDBDocumentClient;

   constructor() {
      this._db = dbDocClient;
   }

   public async getAll(tableName: string): Promise<Record<string, any>[]> {
      const command = new ScanCommand({ TableName: tableName });
      const response = await this._db.send(command);
      return response.Items || [];
   }

   public async getById(tableName: string, keyName: string, keyValue: any): Promise<Record<string, any> | null> {
      const command = new GetCommand({
         TableName: tableName,
         Key: { [keyName]: keyValue }
      });
      const response = await this._db.send(command);
      return response.Item || null;
   }

   public async create(tableName: string, itemObject: Record<string, any>): Promise<Record<string, any>> {
      this.prepare(itemObject);
      const command = new PutCommand({
         TableName: tableName,
         Item: itemObject
      });
      await this._db.send(command);
      return itemObject;
   }

   private prepare(object: Record<string, any>): void {
      object.id = randomUUID();
      object.createdAt = new Date().toISOString();
   }
}

// ---------------------------------------------------------
// MAIN EXPORT
// ---------------------------------------------------------
export default class Apier {
   public req: Request;
   public res: Response;
   public method: Method;
   public db: DbClient;
   public auth: AuthClient;

   constructor(event: any) {
      this.req = new Request(event);
      // this.res = new Response();
      this.res = new Response(event);
      this.method = new Method(event);
      this.db = new DbClient();
      this.auth = new AuthClient();
   }
}