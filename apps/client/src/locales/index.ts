import * as admin from "./admin";
import * as attendee from "./attendee";
import * as checkout from "./checkout";
import * as errors from "./errors";
import * as organizer from "./organizer";
import * as scanner from "./scanner";
import * as support from "./support";

export const localeBundles = [organizer, checkout, attendee, support, admin, scanner, errors];
