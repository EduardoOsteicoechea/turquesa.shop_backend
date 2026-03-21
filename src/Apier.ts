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

   public generateSessionCookie(): string {
      if (!cachedJwtSecret) throw new Error("JWT Secret missing from Parameter Store");
      
      const token = jwt.sign({ role: "admin" }, cachedJwtSecret, { expiresIn: "1h" });
      return `admin_session=${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=3600; Path=/`;
   }
}

// ---------------------------------------------------------
// API WRAPPER CLASSES
// ---------------------------------------------------------
class Response {
   private _headers: Record<string, string> = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json"
   };

   // Now simply takes the generated string from the AuthClient
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

   constructor(event: any) {
      this._requestRoute = event?.rawPath || "";
      this.isHealth = this._requestRoute === "/api/health";
      this.isUsers = this._requestRoute === "/api/users";
      this.isProducts = this._requestRoute === "/api/products";
      this.isRegister = this._requestRoute === "/api/register";
      this.isLogin = this._requestRoute === "/api/login";
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
      this.res = new Response();
      this.method = new Method(event);
      this.db = new DbClient();
      this.auth = new AuthClient();
   }
}