import Apier from "./Apier";

export const handler = async (event) => {
   try {
      const apier = new Apier(event);

      if (event.requestContext && apier.method.isOptions) {
         return apier.res.send();
      }

      if(apier.req.isRegister && apier.method.isPost){
         const request = JSON.parse(event.body);
         const newUser = await apier.db.create("turquesa.shop_users", request);
         return apier.res.send(newUser, 201);
      }

      if (apier.req.isHealth) {
         return apier.res.send({ message: "Enabled" });
      }

      if (apier.req.isUsers && apier.method.isGet) {
         return apier.res.send({ message: "This is where your DynamoDB code goes!" });
      }

      if (apier.req.isProducts && apier.method.isGet) {
         return apier.res.send({
            product_list: [
               {
                  name: "a",
                  price: 1,
                  image_name: "10018.jpg"
               }, {
                  name: "b",
                  price: 2, 
                  image_name: "10033.jpg"
               }
            ]
         });
      }

      return apier.res.send({
         error: "Route not found",
         thePathLambdaSaw: event.rawPath
      }, 404);

   } catch (error) {
      
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