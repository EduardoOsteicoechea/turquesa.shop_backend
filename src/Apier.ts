import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { 
   DynamoDBDocumentClient, 
   ScanCommand, 
   GetCommand, 
   PutCommand 
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";

class Response {
   // Explicitly typed as a dictionary of strings
   private _corsHeaders: Record<string, string> = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json"
   };

   // value defaults to any type, statusCode defaults to a number
   public send(value: any = null, statusCode: number = 200) {
      return {
         statusCode: statusCode,
         headers: this._corsHeaders,
         body: value ? JSON.stringify(value) : ""
      };
   }
}

class Request {
   // Properties must be declared before the constructor in TS
   private _requestRoute: string;
   public isHealth: boolean;
   public isUsers: boolean;
   public isProducts: boolean;
   public isRegister: boolean;

   // We use 'any' for the event here, but you can import APIGatewayProxyEventV2 
   // from '@types/aws-lambda' for even stricter typing!
   constructor(event: any) {
      this._requestRoute = event?.rawPath || ""; 
      this.isHealth = this._requestRoute === "/api/health";
      this.isUsers = this._requestRoute === "/api/users";
      this.isProducts = this._requestRoute === "/api/products";
      this.isRegister = this._requestRoute === "/api/register";
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

const rawClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(rawClient);

class DbClient {
   private _db: DynamoDBDocumentClient;

   constructor() {
      this._db = docClient; 
   }
   
   // Promise specifies exactly what this async method returns
   public async getAll(tableName: string): Promise<Record<string, any>[]> {
      const command = new ScanCommand({
         TableName: tableName
      });
      const response = await this._db.send(command);
      return response.Items || [];
   }

   public async getById(tableName: string, keyName: string, keyValue: any): Promise<Record<string, any> | null> {
      const command = new GetCommand({
         TableName: tableName,
         Key: {
            [keyName]: keyValue
         }
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

   // Private method, returns nothing (void)
   private prepare(object: Record<string, any>): void {
      object.id = randomUUID();
      object.createdAt = new Date().toISOString();
   }
}

export default class Apier {
   public req: Request;
   public res: Response;
   public method: Method;
   public db: DbClient;

   constructor(event: any) {
      this.req = new Request(event); 
      this.res = new Response();
      this.method = new Method(event);
      this.db = new DbClient();
   }
}