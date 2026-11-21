int d0=8;unsigned long lastTick=0;
void setup(){for(int p=2;p<11;p++){pinMode(p,OUTPUT);}Serial.begin(9600);Serial.println(d0);lastTick=millis();}
void loop(){digitalWrite(10,LOW);show(d0);digitalWrite(10,HIGH);delay(2);digitalWrite(10,LOW);if(millis()-lastTick>=40){d0++;if(d0>=10)d0=0;Serial.println(d0);lastTick=millis();}}
void show(int value){switch(value){case 0:digitalWrite(2,HIGH);digitalWrite(3,HIGH);digitalWrite(4,HIGH);digitalWrite(5,HIGH);digitalWrite(6,HIGH);digitalWrite(7,HIGH);digitalWrite(8,LOW);digitalWrite(9,LOW);break;
case 1:digitalWrite(2,LOW);digitalWrite(3,HIGH);digitalWrite(4,HIGH);digitalWrite(5,LOW);digitalWrite(6,LOW);digitalWrite(7,LOW);digitalWrite(8,LOW);digitalWrite(9,LOW);break;
case 2:digitalWrite(2,HIGH);digitalWrite(3,HIGH);digitalWrite(4,LOW);digitalWrite(5,HIGH);digitalWrite(6,HIGH);digitalWrite(7,LOW);digitalWrite(8,HIGH);digitalWrite(9,LOW);break;
case 3:digitalWrite(2,HIGH);digitalWrite(3,HIGH);digitalWrite(4,HIGH);digitalWrite(5,HIGH);digitalWrite(6,LOW);digitalWrite(7,LOW);digitalWrite(8,HIGH);digitalWrite(9,LOW);break;
case 4:digitalWrite(2,LOW);digitalWrite(3,HIGH);digitalWrite(4,HIGH);digitalWrite(5,LOW);digitalWrite(6,LOW);digitalWrite(7,HIGH);digitalWrite(8,HIGH);digitalWrite(9,LOW);break;
case 5:digitalWrite(2,HIGH);digitalWrite(3,LOW);digitalWrite(4,HIGH);digitalWrite(5,HIGH);digitalWrite(6,LOW);digitalWrite(7,HIGH);digitalWrite(8,HIGH);digitalWrite(9,LOW);break;
case 6:digitalWrite(2,HIGH);digitalWrite(3,LOW);digitalWrite(4,HIGH);digitalWrite(5,HIGH);digitalWrite(6,HIGH);digitalWrite(7,HIGH);digitalWrite(8,HIGH);digitalWrite(9,LOW);break;
case 7:digitalWrite(2,HIGH);digitalWrite(3,HIGH);digitalWrite(4,HIGH);digitalWrite(5,LOW);digitalWrite(6,LOW);digitalWrite(7,LOW);digitalWrite(8,LOW);digitalWrite(9,LOW);break;
case 8:digitalWrite(2,HIGH);digitalWrite(3,HIGH);digitalWrite(4,HIGH);digitalWrite(5,HIGH);digitalWrite(6,HIGH);digitalWrite(7,HIGH);digitalWrite(8,HIGH);digitalWrite(9,LOW);break;
case 9:digitalWrite(2,HIGH);digitalWrite(3,HIGH);digitalWrite(4,HIGH);digitalWrite(5,HIGH);digitalWrite(6,LOW);digitalWrite(7,HIGH);digitalWrite(8,HIGH);digitalWrite(9,LOW);break;default:digitalWrite(2,LOW);digitalWrite(3,LOW);digitalWrite(4,LOW);digitalWrite(5,LOW);digitalWrite(6,LOW);digitalWrite(7,LOW);digitalWrite(8,LOW);digitalWrite(9,LOW);break;}}
