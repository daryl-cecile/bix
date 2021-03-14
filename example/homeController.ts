import {Controller} from "../src/Bix.Router";

export default Controller.Instance(router => {

	router.onGET("/whoop", ({request, response})=>{
		response.send("Hi from whoop");
	});

});