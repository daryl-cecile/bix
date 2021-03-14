
import {App} from "../src/Bix";
import {Controller} from "../src/Bix.Router";

import home from "./homeController";

let app = new App({ env: "development" });

app.registerController("home", home);

app.registerController("views", Controller.Instance(router => {

	router.onGET("/", ({next}) => {
		next(new Error("Oopsie"));
	});

	router.onGET("/", ({request, response}) => {
		response.send("Hi");
	});

	router.onGET("/home", ({request, response}) => {
		console.log(request.query);
		response.send("Welcome home");
	});

	router.onGET("/home/:name", ({request, response}) => {
		response.send("Welcome home, " + request.params['name']);
	});

	router.onGET("/json", context => {
		context.response.json(context);
	});

}));

app.listen(3000, ()=>{
	console.log("server ready");
});
