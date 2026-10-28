int d0=8;
int d1=9;
unsigned long lastTick=0;
void setup(){for(int p=2;p<12;p++){pinMode(p,OUTPUT);}lastTick=millis();}
void loop(){for(int p=10;p<12;p++){digitalWrite(p,LOW);}digitalWrite(2,d1==0||d1==2||d1==3||d1==5||d1==6||d1==7||d1==8||d1==9);
digitalWrite(3,d1==0||d1==1||d1==2||d1==3||d1==4||d1==7||d1==8||d1==9);
digitalWrite(4,d1==0||d1==1||d1==3||d1==4||d1==5||d1==6||d1==7||d1==8||d1==9);
digitalWrite(5,d1==0||d1==2||d1==3||d1==5||d1==6||d1==8||d1==9);
digitalWrite(6,d1==0||d1==2||d1==6||d1==8);
digitalWrite(7,d1==0||d1==4||d1==5||d1==6||d1==8||d1==9);
digitalWrite(8,d1==2||d1==3||d1==4||d1==5||d1==6||d1==8||d1==9);
digitalWrite(9,LOW);digitalWrite(10,HIGH);delay(2);digitalWrite(10,LOW);
for(int p=10;p<12;p++){digitalWrite(p,LOW);}digitalWrite(2,d0==0||d0==2||d0==3||d0==5||d0==6||d0==7||d0==8||d0==9);
digitalWrite(3,d0==0||d0==1||d0==2||d0==3||d0==4||d0==7||d0==8||d0==9);
digitalWrite(4,d0==0||d0==1||d0==3||d0==4||d0==5||d0==6||d0==7||d0==8||d0==9);
digitalWrite(5,d0==0||d0==2||d0==3||d0==5||d0==6||d0==8||d0==9);
digitalWrite(6,d0==0||d0==2||d0==6||d0==8);
digitalWrite(7,d0==0||d0==4||d0==5||d0==6||d0==8||d0==9);
digitalWrite(8,d0==2||d0==3||d0==4||d0==5||d0==6||d0==8||d0==9);
digitalWrite(9,LOW);digitalWrite(11,HIGH);delay(2);digitalWrite(11,LOW);if(millis()-lastTick>=40){d0++;if(d0>=10){d0=0;d1++;if(d1>=10){d1=0;}}lastTick=millis();}}
