
import {App} from "./Bix";
import {Controller} from "./Bix.Router";

import home from "./example2";

let app = new App({ env: "development" });

app.registerController(home);

app.registerController(Controller.Instance(async router => {

	router.onGET("/", ({next}) => {
		console.log("skipping");
		next();
	});

	router.onGET("/", ({request, response}) => {
		response.send("Hi");
	});

	router.onGET("/home", ({request, response}) => {
		response.send("Welcome home");
	});

	router.onGET("/json", context => {
		context.response.json(context);
	});

}));

app.listen(3000, ()=>{
	console.log("server ready");
});
