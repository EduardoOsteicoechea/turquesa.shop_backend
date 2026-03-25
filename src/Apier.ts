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

   constructor(event: any) {
      this._requestRoute = event?.rawPath || "";
      this.isHealth = this._requestRoute === "/api/health";
      this.isUsers = this._requestRoute === "/api/users";
      this.isProducts = this._requestRoute === "/api/products";
      this.isRegister = this._requestRoute === "/api/register";
      this.isLogin = this._requestRoute === "/api/login";
      this.isAuthenticated = this._requestRoute === "/api/is-authenticated";
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