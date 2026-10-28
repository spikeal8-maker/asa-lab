int d0=8;
unsigned long lastTick=0;
void setup(){for(int p=2;p<11;p++){pinMode(p,OUTPUT);}lastTick=millis();}
void loop(){for(int p=10;p<11;p++){digitalWrite(p,LOW);}digitalWrite(2,d0==0||d0==2||d0==3||d0==5||d0==6||d0==7||d0==8||d0==9);
digitalWrite(3,d0==0||d0==1||d0==2||d0==3||d0==4||d0==7||d0==8||d0==9);
digitalWrite(4,d0==0||d0==1||d0==3||d0==4||d0==5||d0==6||d0==7||d0==8||d0==9);
digitalWrite(5,d0==0||d0==2||d0==3||d0==5||d0==6||d0==8||d0==9);
digitalWrite(6,d0==0||d0==2||d0==6||d0==8);
digitalWrite(7,d0==0||d0==4||d0==5||d0==6||d0==8||d0==9);
digitalWrite(8,d0==2||d0==3||d0==4||d0==5||d0==6||d0==8||d0==9);
digitalWrite(9,LOW);digitalWrite(10,HIGH);delay(2);digitalWrite(10,LOW);if(millis()-lastTick>=40){d0++;if(d0>=10){d0=0;}lastTick=millis();}}
