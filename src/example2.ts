import {Controller} from "./Bix.Router";

export default Controller.Instance(router => {

	router.onGET("/whoop", ({request, response})=>{
		response.send("Hi from whoop");
	});

});