import Apier from "./Apier";

export const handler = async (event: any) => {
   try {
      const apier = new Apier(event);
      
      // 1. Safely parse the body ONLY if it exists
      const requestBody = event.body ? JSON.parse(event.body) : {};

      if (event.requestContext && apier.method.isOptions) {
         return apier.res.send();
      }

      // --- LOGIN ROUTE ---
      if (apier.req.isLogin && apier.method.isPost) {
         await apier.auth.loadSecrets();
         if (!apier.auth.isValidAdmin(requestBody.code)) return apier.res.send({ error: "Unauthorized" }, 401);
         const cookieString = apier.auth.generateSessionCookie();
         apier.res.setAuthCookie(cookieString);
         return apier.res.send({ message: "Login successful!" }, 200);
      }

      // --- REGISTER ROUTE ---
      if (apier.req.isRegister && apier.method.isPost) {
         const newUser = await apier.db.create("turquesa.shop_users", requestBody);
         return apier.res.send(newUser, 201);
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
            error: error.message,
            thePathLambdaSaw: event.rawPath
         })
      };
   }
};